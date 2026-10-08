# Design: sitemap-crawl-merchants

## Context

The existing pipeline ingests WooCommerce Store API feeds: `IFeedAdapter.fetch()`
returns `RawFeedRecord[]`, flows through governance gate → map (EUR, litres) →
volume-ceiling gate → upsert → data-quality, orchestrated as a Cloudflare
Workflow. A sitemap crawl source differs in one structural way: the feed is not
one paginated API but ~10⁴ individual HTML pages, discovered via a sitemap and
changing asynchronously. Production budgets measured in this repo: 15-min
scheduled wall time (aggregation died at ~880 products / 84k statements before
chunk-300 + statement pinning) and ~1,000 subrequests per invocation
(savings walk needed chunk-300 + watermark cursor). Politeness is currently
per-adapter code discipline, not a framework.

## Decisions

### D1: Workers-native crawling — never the host

The crawl runs on the API Worker via the existing Workflow/cron machinery.
Host-side scripting was rejected: it burns the local CPU the product explicitly
protects, and it would split the pipeline across two runtimes. Cost shifts to
subrequest/wall budgets, handled in D5.

### D2: A crawl walker shared by all sitemap sources, behind `IFeedAdapter`

One walker implements the politeness and budget rules (sequential per host,
≥ 1 s spacing, descriptive UA, bounded by the sitemap URL set, failures
collected — the "must not throw" adapter contract). Sitemap-crawl sources
subclass/wire it with a per-source config, exactly as the four retailers share
`WooStoreFeedAdapter`. Governance records use the existing
`COMPLIANT_CRAWLING` acquisition method — the enum already anticipated this.
A per-source free-for-all crawler was rejected as drift-prone and unauditable.

### D3: Extraction tiering — structured data first, bounded fallbacks

Order: JSON-LD `Product` → schema.org microdata → OG/meta + per-source
normalizer. Recon verdicts: licorea JSON-LD complete (incl. `gtin13`);
viinarannasta microdata with `GTIN13`; drinkonline JSON-LD with `offers` as an
array; viinikauppa thin JSON-LD whose `brand` is the store name (override) and
whose ABV lives only in description prose (regex); volume/ABV-from-title
parsing reuses the existing parser heuristics. Images and long descriptions are
not ingested — minimization, and nothing downstream consumes them today.

### D4: Incremental sync via sitemap `lastmod`; full refresh where absent

Per merchant, the last crawl's `loc → lastmod` map persists (watermark
pattern); a cycle crawls only new or changed URLs. drinkonline exposes no
`lastmod`, so it is configured as full-refresh (1,838 pages ≈ 31 min at 1 req/s
— acceptable daily). A first crawl is always full.

### D5: Chunked, resumable walks on the proven watermark pattern

≤ 300 detail-page fetches per workflow step, cursor persisted in
`aggregation_watermarks` (merchant-scoped key), resumable across invocations —
the same fix pattern as time-series aggregation and savings snapshots. At
1 req/s a 300-fetch chunk costs ~5 min wall, well inside the 15-min budget and
the subrequest ceiling.

### D6: Parked sources are governance rows, not code

spritxxl (bot wall) and lazyshop (no extractable attributes; rows would be
held by the non-alcoholic guard anyway) get `source_governance` rows as
`PENDING` with a `statusReason`, and no `feedUrl` — the producer skips them by
its existing empty-feedUrl rule. This follows the Posti precedent (blocked
egress → curated/parked, not fought) and makes unparking a data change, not a
deploy.

### D7: Sequencing after `nonalcoholic-catalog-hygiene`

That in-flight change edits the shared parser (`alks.parser.ts`, source-category
mapper) and establishes ingestion-time hold discipline. Crawl records flow
through the same mapper, so this change rebases on its result; zero-ABV or
attribute-less crawl rows must land as held/ESTIMATED per its contract.

## Risks

- **Egress blocking appearing mid-life** (site adds a WAF later): walker
  surfaces challenge responses as collected errors → merchant feed degrades to
  UNAVAILABLE instead of hammering; operator alerting via existing error
  reporting.
- **HTML/markup drift** breaks extraction (esp. the two no-JSON-LD or thin
  sources): per-source golden fixtures + sweep scripts catch drift before the
  scheduled pipeline does; data-quality grading bounds the blast radius.
- **EAN-less matching quality** (viinikauppa, drinkonline): name/brand/ABV
  heuristics as in `alks.parser.ts`; expect lower match rates — measured by
  data-quality, reported honestly rather than forced.
- **robots/politeness**: no `Crawl-delay` directives exist on these hosts; the
  walker's self-imposed 1 req/s is the policy, and the UA identifies the
  platform honestly.

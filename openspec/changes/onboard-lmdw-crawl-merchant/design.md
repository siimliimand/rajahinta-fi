# Onboard LMDW crawl merchant — Design

## Context

Twelve merchants ingest through the governed pipeline: the Alko domestic reference feed, six store-API adapters (alks/DE, longero/EE, kippis/FI, mydrink/EE, araxes/EE over the shared Woo walk; bottleofitaly/IT, kuhns/DE over the shared Shopify walk), and four sitemap-crawl merchants (viinarannasta, viinikauppa, licorea, drinkonline) sharing `SitemapCrawlFeedAdapter`. The crawl pattern: the sitemap is fetched once per cycle and diffed by `lastmod` against job-scoped `aggregation_watermarks` rows (`sitemap-crawl-lastmod-<merchantId>`, cursor `sitemap-crawl-cursor-<merchantId>`); changed product pages are crawled in resumable chunks of at most 300 fetches (sequential per host, at least 1 s spacing, descriptive UA); extraction prefers structured data (JSON-LD, then schema.org microdata, then OG/meta) with per-source normalizers; a non-EUR price is recorded as a correction error rather than converted.

The archived change `onboard-shopify-lmdw-merchants` spiked a GraphQL-products adapter for La Maison du Whisky and measured a NO-GO: feed-side ABV 10.3 % across 6,814 distinct SKUs, volume absent from all 76 `ProductInterface` fields, `custom_attributesV2` internal-errors — while the product-page state JSON carries `"volume"` (litres) and `"strength"` (ABV) on 100 % of the sampled pages, served at `https://www.whisky.fr/<url_key>.html` (10/10 HTTP 200 under the honest crawler UA). The gateway is EUR-native across the full walk (EUR × 6,814, zero unparseable prices), SKUs are numeric internal codes, and no weight field surfaced.

## Goals / Non-Goals

**Goals:**

- LMDW onboards through the proven crawl pattern on the daily cadence — full-coverage ABV/volume from the only source that has it (the product page).
- The URL-source shape is decided by measurement, not assumption: product sitemap if one exists, GraphQL-seeded URL list otherwise.
- Page-side French category vocabulary lands additively from a measured census (the GraphQL m3 labels are reference evidence, not wiring).
- GTIN13 recorded when the page attests it — potentially LMDW's first real EANs, enabling Alko-reference joins.

**Non-Goals:**

- GraphQL adapter revival, `custom_attributesV2` debugging, m3-side vocabulary wiring.
- GTIN fabrication of any kind; upsert matching relaxation; correction-queue remediation.
- Full-catalog crawling inside the probe; frontend or API-contract changes.

## Decisions

### D1 — URL source: probe-decided, two accepted shapes

Task 1.1 checks robots.txt sitemap directives and `sitemap.xml` (+ indexes) for a product-URL sitemap covering whisky.fr product pages.

- **Pure sitemap (preferred)**: `LmdwFeedAdapter extends SitemapCrawlFeedAdapter` with `merchantId: 'lmdw'` and the merchant's sitemap URL as the registry `feedUrl` (`feedFormat: 'xml'`) — the identical shape of the four live crawl merchants; no new machinery.
- **GraphQL-seeded variant**: if no product sitemap exists, the adapter seeds its URL list from `products(filter: { category_id: { eq: "3" } }, pageSize, currentPage)` → `url_key` set (the mandatory-filter walk, `sku` dedupe), then crawls pages identically. The seed walk is URL-source only — no product data is read from GraphQL (the NO-GO stands). Watermarks/cursors work the same; the seeded list replaces the lastmod diff's URL enumeration, with the crawl chunking unchanged.

The probe records the decision + evidence in the notes; the adapter task is blocked on it.

### D2 — whisky.fr per-source page normalizer

The crawl extractor's per-source normalizer gains a whisky.fr reader: the page's embedded state JSON carries `"volume"` (litres — × 1000 → `volumeMl`) and `"strength"` (ABV percent — ÷ 100 → `alcoholByVolume`), with guarded parsing (comma/dot decimals, plausibility window `0 < abv ≤ 100`, `0 < volume < 100` litres per the pipeline's unit window). Missing or unparseable fields ride the keyed-uncertainty ESTIMATED path — never guessed. Price from JSON-LD `price`/`priceCurrency` (EUR minor units; a non-EUR currency is a per-row correction error, Posti precedent). `vendor`/brand from JSON-LD `brand`/`seller` per the established crawl extraction order. `depositSystem: false` — French consigne is not Finnish pantti, and no attested deposit field is read.

### D3 — Page-side French category vocabulary (not the GraphQL m3 labels)

The probe censuses the category signal pages actually carry (JSON-LD `category`, breadcrumbs) and task 2.1 wires those exact spellings as additive keys. The 137-label `m3_family` census from the archived spike stays as reference evidence — no GraphQL surface ships in this change, so wiring its labels would be dead vocabulary. Deliberately unmapped: gift boxes, non-beverage terms, merch — correction queue, never a guessed tax key.

### D4 — GTIN13: page-attested only

The probe measures `gtin13` presence in product JSON-LD. If present, records carry real EANs through the existing JSON-LD GTIN path (the PR #107 case-insensitive itemprop fix) — the accepted EAN forms then join, and Alko-reference savings become possible for matched products. If absent, the worst case is 6,814 EAN-less correction lines/run — accepted per the BOI precedent (22,937), with the registry-level drop-filter as the named follow-up. Zero fabrication in either world.

### D5 — Crawl discipline is inherited, not reinvented

Sequential per-host fetching, ≥ 1 s spacing, ≤ 300-fetch resumable chunks, watermark/cursor diffing, per-page failures collected never thrown, honest crawler UA (the 5.1-measured hard-403 rule for empty-UA clients), non-EUR = correction error. The seeded variant (if chosen) changes only the URL enumeration — chunking, watermarking, and politeness stay the shared code's.

### D6 — Workers-egress smoke at staging

Standing rule (Posti 403/1031 precedent): the first real production-shaped fetches happen at staging and are recorded per source before any production registration. The crawl UA is the measured-good shape from 5.1/6.2.

### D7 — Registry row and rollout shape

Seed row (probe-final): `('lmdw', 'La Maison du Whisky', 'FR', <feedUrl>, 'xml'|'json', 86_400_000)` — `feedUrl` is the sitemap URL on the pure path or the storefront root on the seeded path; `feedFormat` follows the crawl-row convention (`xml` when sitemap-driven). Governance `RETAILER_API` (the operator holds usage rights to the public product pages). Local → staging → production strictly ordered; production registration through the audited ops console (blanket-permission auto-grant, runbook §2.0); the scheduled 00:00 UTC pass is the convergence mechanism (the manual-first-ingest lesson from the Shopify pair carries over: expect 429/429-shaped throttle behavior on fat unpaced runs, record honestly, let the cadence converge).

## Risks

- **No product sitemap** → the seeded variant adds a GraphQL URL-walk to the crawl shape (new code, but URL-source only; the spike's walk mechanics are proven).
- **State-JSON shape drift** → the normalizer is per-source and guarded; unparseable pages ride ESTIMATED + correction, never guessed; the probe's 300-page sample measures stability before wiring.
- **Page-side category signal is weak** → task 2.1's census decides the vocabulary; if the signal is too sparse, the change pauses after 1.1 with the evidence (the hold-rule makes a mostly-unclassified catalog worthless — the same NO-GO logic as the spike).
- **Rate throttling** (the Shopify pair's measured behavior) → crawl chunking + ≥ 1 s spacing + daily cadence; staging/production evidence records honest partials.

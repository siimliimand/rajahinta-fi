# Onboard LMDW crawl merchant — Notes

> Operator/engineer log. The spike baseline below comes from the archived
> change `onboard-shopify-lmdw-merchants` (notes §1.3, verified
> 2026-10-08). Probe/sweep numbers are filled by whoever runs them — TBD
> placeholders are filled by the operator only, never pre-filled.

## Spike baseline (inherited, archived change notes §1.3)

- Full GraphQL walk: 6,814 distinct SKUs / 6,821 total_count (69 pages, 0
  failures); feed-side ABV (short_description) only 10.3 % → the NO-GO.
- Product pages `https://www.whisky.fr/<url_key>.html`: 10/10 HTTP 200 under
  the honest crawler UA; state JSON `"volume"` (litres) + `"strength"` (ABV)
  on 10/10 sampled pages — the full-coverage ABV/volume source.
- `m3_family` GraphQL census: 137 labels (reference evidence only — this
  change wires the page-side census, not the GraphQL one).
- EUR × 6,814, zero non-EUR; SKUs numeric; no weight field seen;
  `custom_attributesV2` internal-errors (rejected).
- GraphQL contract: `filter` OR `search` mandatory on `products`; pagination
  `pageSize`/`currentPage` to `total_count`.

## 1.1 Crawl probe results + URL-source decision

Probe: `scripts/lmdw-crawl-probe.ts`, run 2026-10-08 from this host (Node
v24.21, `pnpm --filter @rajahinta/data-platform exec tsx
../../scripts/lmdw-crawl-probe.ts`), read-only GETs + URL-source-only
GraphQL reads, UA `rajahinta-crawler/1.0 (+https://rajahinta.fi)`,
sequential, 1.1 s page pacing, 20 s per-fetch timeout, single bounded
retry, every failure collected. Sample: 300 URLs by even stride over the
product-shaped sitemap entries. Result: **300/300 pages fetched, 0 page
failures, 0 walk failures.**

**Sitemap availability** — robots.txt declares two `Sitemap:` directives:
`https://www.whisky.fr/media/sitemap/sitemap_whimag.xml` (FR store urlset,
9,964 entries, HTTP 200) and `.../sitemap_whimag_en.xml` (EN store, 9,765
entries). Bare `https://www.whisky.fr/sitemap.xml` is HTTP 404 (Next.js
HTML 404 page). Totals: 19,728 unique locs, **19,727 with `lastmod`**
(1 without). Product-shaped URLs (single path segment, `<url_key>.html`,
FR store): **6,842**. No sitemap indexes — both directives are urlsets.

**GraphQL url_key cross-walk** (URL-list use only; the spike NO-GO on
reading product data from GraphQL stands): `total_count` 6,875, 6,853
distinct skus (15 duplicate-sku rows, 0 failures; 69/70 pages ok, page 70
empty → pagination end). Predicate coverage — overlap sitemap ∩ catalog =
6,730 → **precision 98.4 %** (share of sitemap candidates that are catalog
products; the 97 non-catalog locs are CMS pages like
`nature-de-produit.html` plus live drift), **recall 98.2 %** (share of
catalog products present in the sitemap). Catalog churn between the two
probe runs the same day (6,868 → 6,853 distinct skus) confirms a live,
changing catalog — the daily cadence + lastmod diff is the convergence
mechanism, exactly as designed.

**DECISION (design D1): PURE SITEMAP.** `LmdwFeedAdapter extends
SitemapCrawlFeedAdapter`, `merchantId: 'lmdw'`, registry `feedUrl =
https://www.whisky.fr/media/sitemap/sitemap_whimag.xml`, `feedFormat:
'xml'`, product-URL predicate = single-segment `https://www.whisky.fr/
<url_key>.html` (the same shape as the four live crawl merchants; no new
machinery, no GraphQL-seeded variant). Non-product pages that pass the
predicate (measured ~1.6 % of entries) ride the D2 guarded-extraction
path — no volume/strength extract → keyed-uncertainty ESTIMATED +
correction, never guessed. The 98.2 % recall gap is handled by the daily
scheduled pass converging on sitemap regeneration.

**State-JSON extraction** (the D2 normalizer facts): the carrier is
`<script id="__NEXT_DATA__" type="application/json">` — pure JSON,
`JSON.parse` direct on 299/300 carrier pages (no assignment-slice needed).
- `volume` (litres): **297/300 (99.0 %)** present-and-numeric; guarded
  parse rejects 2 more (`"volume":"0"` → 0 not > 0) → **295/300 (98.3 %)
  usable**. All 297 reads are string-dot form (`"volume":"0.7"`).
  Top values: 0.7×224, 0.5×20, 0.75×12, 1×4, 0.05×4, 0.02×4, 0.72×4,
  0.059×3 (miniatures), 0×2.
- `strength` (ABV %): **299/300 (99.7 %)** present-and-numeric; guarded
  parse rejects 12 (`"strength":0` — non-alcoholic items) → **287/300
  (95.7 %) usable**. Forms: bare number ×297, string-dot ×2. Top values:
  40×47, 43×22, 45×13, 46×13, 0×12, 35×9.
- Guard necessity is **measured**: digit-free
  `"volume"/"strength"` i18n-dictionary strings appear on **300/300
  pages** (the normalizer MUST require pure-numeric values); digit-bearing
  non-conforming forms (`"45,8 %"`): 0/300.
- Exact key paths: `props.pageProps.productFromServer › volume` ×295 and
  `… › strength` ×295 (the canonical path). Alternate paths on 2 pages
  (`props.pageProps.document.data.body[2].items[0].product.attributes[20]
  › volume` / `[16] › strength` — CMS-rendered products without
  `productFromServer`) and on 2 redirect/listing-shaped pages
  (`categoryFromServer.products.items[0]` / `products.items[0]`) — the
  normalizer reads the `productFromServer` path and lets the rest fall to
  ESTIMATED. No-volume pages: `nature-de-produit.html` (CMS — expected
  predicate imprecision) + 2 Hampden product pages (alternate path above).
- Litres → ml ×1000 and percent → ÷100 confirmed against the pipeline
  windows (0 < litres < 100; 0 < abv ≤ 100) with the rejection counts
  above.

**Category signal census** (design D3 vocabulary input):
- JSON-LD `@type: Product` on 295/300 pages — but the `category` field is
  **absent everywhere** (0 distinct values).
- `BreadcrumbList` on 298/300 pages, 558 distinct terms — but the
  vocabulary is **geography + brand** (`Accueil`×295, `ecosse`×75,
  `france`×74, `japon`×21, `mexique`×18, `italie`×12, `belgique`×6,
  `irlande`×5, `jamaique`×5, plus brand crumbs LAPHROAIG×4, GLENLIVET×4,
  CAOL ILA×4…). Not product-type vocabulary — not mapper material.
- **The page-side product-type signal is the state JSON's m3 taxonomy** —
  present on **300/300 sampled pages**, the same m3 system as the archived
  137-label census, now measured where the crawl will actually read it:
  distinct labels: `m3_category` 40, `m3_family` 66, `m3_subfamily` 71,
  `m3_division` 2 (179 distinct key+label pairs). Top labels:

  | key | label (exact spelling) | pages |
  |---|---|---|
  | m3_division | liquide | 291 |
  | m3_category | whisky | 123 |
  | m3_family / m3_subfamily | single malt whisky | 99 |
  | m3_category | rhum | 41 |
  | m3_family / m3_subfamily | rhum | 31 |
  | m3_category | liqueurs | 18 |
  | m3_category | gin | 15 |
  | m3_category / m3_family / m3_subfamily | tequila (subfamily: tequila 100% agave) | 11 |
  | m3_family | Types de produit | 10 |
  | m3_family / m3_subfamily | blended whisky | 10 / 6 |
  | m3_subfamily | distilled gin | 10 |
  | m3_category / m3_family / m3_subfamily | sakes / bitters cocktails | 8 / 7 |
  | m3_category / m3_family / m3_subfamily | mezcal | 7 |
  | m3_family / m3_subfamily | rhum agricole / agricole rum | 6 |
  | m3_category | vodka | 6 |
  | m3_category | amers | 6 |
  | m3_category | autres spiritueux | 5 |
  | m3_* | BOISSONS SANS ALCOOL | 5 |
  | m3_* | armagnacs | 5 |
  | m3_* | cognacs | 4 |
  | m3_division | solide | 4 |

  Task 2.1 wires these exact spellings as additive keys; deliberately
  unmapped per the design: `BOISSONS SANS ALCOOL`, `solide`, gift/merch
  terms → correction queue. The `strength: 0` (×12) and `volume: "0"`
  (×2) rows are the same non-alcoholic/non-liquid population the
  listing-universe guard holds out — they land in correction, never as
  zero-ABV alcohol rows.

**GTIN13 verdict (design D4): PRESENT — page-attested only.** JSON-LD
`gtin13` on **220/300 pages (73.3 %)**; microdata `itemprop="gtin…"`:
0. All 220 values are 13-digit and **all 220 pass the GS1 check digit**
(0 invalid). The state JSON's `ean` field carries the identical values on
the identical 220 pages (samples: 5000277000982, 5060188980049,
7406341000106, 4995762103006, 3049197210776, 3586889931804, 3297364272038,
0724803003005, 3443210151020, 0856972005174) — two independent page-side
attestations of the same EAN. The ~26.7 % EAN-less remainder rides the
accepted correction path (D4; BOI 22,937 precedent) — zero fabrication.

**EUR verdict: CLEAN.** JSON-LD offers `priceCurrency` = EUR on all 295
Product-JSON-LD pages, 0 unparseable prices, 0 JSON-LD parse errors
(page-side; the GraphQL feed was EUR × 6,814 in the archived sweep).

**GO for task 3.1** — volume 99.0 % / strength 99.7 % raw (98.3 % / 95.7 %
after the guarded windows), URL source settled (pure sitemap, lastmod
99.99 %), category signal dense and page-side (m3 labels on 300/300
pages), GTIN real where attested, EUR clean. Conditions carried into 3.1:
ESTIMATED/correction paths for the measured minorities (no-volume 1.7 %,
implausible 14 rows, CMS-page ~1.6 % of sitemap entries, EAN-less ~26.7 %,
non-alcoholic m3 terms), never guesses.

## 2.1 Mapper re-probe drop rate

The 1.1 probe's report prints only the top-40 of its 179 distinct
key+label pairs, so task 2.1 re-ran the census before wiring (same
read-only discipline: honest UA, sequential, 1.1 s pacing, 20 s timeout,
single bounded retry, even-stride 300-page sitemap sample;
2026-10-08) and captured every pair plus the per-page label sets. The
re-run reproduced the recorded census exactly: 300/300 pages, 179
distinct key+label pairs (m3_category 40, m3_family 66, m3_subfamily
71, m3_division 2), identical top-40 with identical page counts.

Vocabulary wired: **94 of the 105 distinct census labels map (160 of
the 179 key+label pairs); 11 labels (19 pairs) are deliberately
unmapped** — `liquide`/`solide` (the m3_division labels carry no
beverage type; pages classify from their category/family/subfamily
labels), `Types de produit` (generic navigation family), the
glassware/barware set (`verres`, `verres de degustation`, `bartools`,
`autres bartools`), `magazine`, `sirops/cordials` (syrups — the alks
`Siirappi` precedent), the bare adjective `SPICED`, and the
heterogeneous `AUTRES ALCOOLS SUCREES` bucket (the araxes `lahja
alkohol` precedent). Design D3's gift-box/coffret rule stays in force
(the `solide` branch; none surfaced in this sample). Existing keys
already carried `whisky`/`gin`/`vodka`/`calvados` and
`tequila`/`brandy`/`aquavit`/`vermouth`/`champagne`/`ale`/`ipa`/
`pilsner` (normalizeCategory) — no duplicate keys wired. `sakes` maps
to the existing canonical `sake` category (other_fermented, bounded at
22 % like every fermented bucket); the sake subfamilies hyphenate where
the family labels space (`sake-moderne` vs `sake moderne`), and exact
matching carries both spellings. `punch au rhum` → long-drink (the
`cocktails` alks RTD precedent); `aperitivo` → fortified-wine (the
`aperitif` family's Italian spelling).

Drop rate — offline per-page replay of the re-run census through the
real `mapSourceCategory` (no ABV argument: the pure vocabulary outcome;
a page classifies when any of its m3 labels maps — the same
first-mappable-candidate contract the parser uses):

| vocabulary state | classified | dropped |
|---|---|---|
| before the FR vocabulary (17/179 pairs mapped) | 166/300 (55.3 %) | 134/300 (44.7 %) |
| after — this task (160/179 pairs mapped) | **289/300 (96.3 %)** | **11/300 (3.7 %)** |

The 11 dropped pages carry only deliberately-unmapped labels
(`Types de produit` ×5, `liquide` ×4, `solide` ×4, `verres de
degustation` ×4, `AUTRES ALCOOLS SUCREES` ×3, `magazine` ×3,
`sirops/cordials` ×3, `autres bartools` ×2, `verres` ×2, `bartools` ×1
— several labels per page) — exactly the correction-queue population,
never a guessed category. The residual 3.7 % is bounded by design:
every future gift-box/merch page lands in the same queue, and the
vocabulary is additive if a later census attests new beverage terms.

## 5.1 Local rollout evidence

Executed 2026-10-08, ~19:04–19:50 UTC, branch
`feature/onboard-lmdw-crawl-merchant`. Node v24.21.0
(`/root/.nvm/versions/node/v24.21.0`) for every command — the host default
v22.14.0 lacks FTS5 in `node:sqlite` (the 4.1 environmental note).
`@rajahinta/core-domain` rebuilt first (`tsc`, exit 0). All writes LOCAL
(`wrangler d1 execute DB --local`, `wrangler dev --port 8787
--test-scheduled` from apps/api-worker); live contact was **read-only GETs
to www.whisky.fr only** — 4 sitemap fetches + 668 detail-page fetches
(300 + 300 chunk walks, a ~17-page interrupted slice, 41 + 8 re-crawl
pages, 2 spot-checks) at the shared walker's ≥ 1 s spacing (measured
≈ 1.59 s/page), UA `rajahinta-crawler/1.0 (+https://rajahinta.fi)`, 0
fetch failures; zero other merchants contacted (the four seeded GRANTED
crawl merchants were never due and never enqueued); zero staging or
production contact. Nothing committed.

### Local D1 state found (read-only probes before any write)

Registry 11 rows (no `lmdw` — alko, alks, araxes, bottleofitaly, kuhns,
the four crawl merchants, spritxxl, lazyshop); `source_governance` 6 rows
(the 4 GRANTED crawl seeds + spritxxl/lazyshop PENDING); `retail_offers`
48 (seed fixture merchants only — pohjolan_tuonti, suomi_logistiikka,
test-merchant-de/se); `product_master` 47 rows, max id 9002;
`aggregation_watermarks` 0 rows. (This is a reset local state — the
archived change's local rows are gone; all baselines below are against
these numbers.)

### Registry row via the seed; governance grant (local)

- **Registry via the seed** (4.2's row): `pnpm --filter
  @rajahinta/data-platform exec tsx ../../scripts/seed-d1.ts --local` →
  migrations no-op, seed re-applied idempotently, **verification PASSED**.
  Read-back: **`lmdw` id 12** `('La Maison du Whisky', 'FR',
  'https://www.whisky.fr/media/sitemap/sitemap_whimag.xml', 'xml',
  86400000)` — fields exact. Registry now 12 rows.
- **Governance** (the seed deliberately does NOT create it — task 4.2's
  note; no `.dev.vars` → `/ops` 403 locally → direct NOT-EXISTS-guarded
  INSERT, the araxes-3.1 path; the audited console is 6.2/7.2's):
  **id 7, `lmdw`, `RETAILER_API`, `GRANTED`, sourceUrl
  `https://www.whisky.fr`**, reason "local grant for first-ingest
  verification (task 5.1 onboard-lmdw-crawl-merchant; local-only
  disposable row)", last_verified_at 2026-10-08T19:10:00Z. All fields
  read back exact. **Local-only — disposable.**

### Producer ticks (fail-closed → bucket-gate → exactly-one enqueue)

`wrangler dev --port 8787 --test-scheduled`; ticks via
`curl /cdn-cgi/handler/scheduled?cron=0+*+*+*+*`:

1. **Pre-grant real-clock tick**: `Not scheduling merchant "lmdw": no
   governance records — defaulting to PENDING`; `enqueued 0/12 … (4 not
   due this tick)` — the §0 fail-closed contract.
2. **Post-grant real-clock tick** (daily cadence intact): lmdw
   recognized, deferred by the interval bucket — `enqueued 0/12 … (5 not
   due this tick)` (lmdw the 5th; the four crawl merchants the others).
3. **Due tick** via the runbook §6.6 off-schedule pattern
   (`pollingIntervalMs` temporarily 3,600,000 — the documented hourly
   minimum — restored to 86,400,000 immediately after): **`enqueued 1/12`
   — exactly one message**, `{"dedupeKey":
   "price-ingestion-lmdw-2026-10-08-19","merchantId":"lmdw","sourceUrl":
   "https://www.whisky.fr/media/sitemap/sitemap_whimag.xml"}`; consumer
   log `Ingesting prices for merchant lmdw …` → `Handed off … to Workflow
   instance price-ingestion-lmdw-2026-10-08-19`.

### Run 1 (queue path) — discover, watermark/cursor rows, chunked resumable crawl

Instance `price-ingestion-lmdw-2026-10-08-19`, status evidence via the
Local Explorer API (`GET /cdn-cgi/local/explorer/api/workflows/
rajahinta-price-ingestion-dev/instances/<id>`):

- `governance-gate-1`: `{"permitted":true,"status":"GRANTED"}` — the
  pipeline gate honored the grant.
- `crawl-discover-1` (1.8 s): sitemap fetched once → product-URL filter →
  **full diff, `queueLength` 6,842** (the probe's product-shaped count
  exactly), `resumed:false`.
- **Both D1 rows written at begin, cursor-first order (19:09:32.138Z /
  .173Z)**: `sitemap-crawl-cursor-lmdw` (421,255 bytes —
  `{queue: [6,842 URLs], offset: 0}`) and `sitemap-crawl-lastmod-lmdw`
  (612,810 bytes — 6,842 `loc → lastmod` entries), in
  `aggregation_watermarks`.
- `crawl-chunk-1-1` 19:09:32→19:17:28 (**7m56s, 300 fetches ≈ 1.59 s/page
  — the ≤300-fetch D5 cap holding**): 300 fetched, **261 records**, 55
  collected errors, 0 fetch failures. `crawl-advance-1-1` → **cursor
  offset 300**. Budget-reset sleep 1 s. `crawl-chunk-2-1`
  19:17:29→19:25:08 (7m39s): 300 fetched. `crawl-advance-2-1` → **offset
  600**.
- Chunk boundary URLs read from the captured cursor JSON:
  queue[299] `whisky-magazine-numero-5.html` | queue[300]
  `whisky-magazine-numero-9.html` | queue[599]
  `wimmer-czerny-2011-gruner-veltiner-blanc.html` | queue[600]
  `christian-drouin-carafe-xo-pierre-pivet.html`.
- **Bounded-run stop** (the full 6,842-URL walk ≈ 2 h was explicitly out
  of scope): worker killed 19:25:36 UTC, ~17 pages into chunk-3 (a
  partial chunk walk is nondurable by design — the write-then-advance
  protocol). Cursor row captured at offset 600, then **the cursor row
  deleted** (recorded local operator action — the bounded-run measure;
  the safe-direction consequence is the designed vanished-cursor path).
- **Restart resume**: on restart the instance replayed its durable steps
  from cache (discover/chunk-1/advance-1/chunk-2/advance-2 outputs
  instant, no re-fetch — the walked prefix never repeated) and re-ran
  chunk-3, which returned the designed
  `lmdw crawl cursor vanished mid-cycle — chunk skipped, cycle ended`
  (`done:true`) — the cycle ended, nothing further crawled.
- **Dev-runtime deviation (recorded, not chased)**: the plain restart did
  NOT resume the mid-step-killed instance (stale `running`, no new step
  attempts — the archived pair's engine-wedge note, this time not
  cleared by a restart). The Local Explorer instance-status API
  (`PATCH …/status {"action":"restart"}`) re-ran the instance at
  19:34:21Z — and that fresh re-run delivered its own evidence:
  **`crawl-discover` re-diffed the live sitemap against the 33-minute-old
  watermark → `queueLength` 0** (all 6,842 product URLs unchanged — the
  lastmod diff skipping everything), then the vanished-cursor branch
  ended the cycle (`productsIngested: 0`, instance `complete`). The
  restart action re-executes from the top (pre-restart step outputs are
  not replayed), so run 1's 600 walked records never reached
  map/upsert; the completing runs below were driven explicitly via the
  local Workflows-API path (the staging-6.2 trigger shape).

### Run r2 (local Workflows API) — offers land with page-extracted ABV/volume

**Watermark lowering** (recorded local operator action — the runbook §7.3
watermark-lowering precedent, local-only): the lastmod row 6,842 → 6,801
entries, 41 locs removed — 28 record-bearing product pages across the
landed categories, 10 deliberately-unmapped-label pages (verres/flasques/
livre/magazine/coffret-accessoires/bec-verseur), 2 CMS routes.
`POST /cdn-cgi/local/explorer/api/workflows/rajahinta-price-ingestion-dev/
instances` with id/params `price-ingestion-lmdw-2026-10-08-r2`
(mirroring the producer message shape):

- `crawl-discover-1`: **`queueLength` 41 — exactly the lowered set**
  (6,801 unchanged entries skipped; zero sitemap churn since 19:09). The
  lastmod diff is thus measured in both directions on the real sitemap:
  6,842 (first cycle) → 0 (nothing changed) → 41 (only the lowered locs).
- `crawl-chunk-1-1`: 41 fetched (~60 s), **29 records**, `done:true`
  (queue drained in one chunk).
- map → volume-ceiling-gate → **`upsert-offers-1-1`: recordsAdded 29,
  recordsUpdated 0, offersChanged 29, zero upsertErrors** → data-quality
  (implausibleVolume 0, zeroPriceRejections 0) → **`complete`,
  `productsIngested: 29`**. Reconciliation: 41 fetched = 29 ingested
  + 2 CMS no-record + 10 correction-dropped pages, exact.
- **Error census (29 collected lines)**: 2 CMS `structured product
  carries no usable name+price` (the measured ~1.6 % predicate
  imprecision riding the guarded path); 10 no-usable-strength + 5
  no-usable-volume keyed-uncertainty lines; **10 no-canonical-category
  corrections over 10 pages, every source label named** —
  `AUTRES ALCOOLS SUCREES`, `flasques`, `bartools`/`autres bartools`,
  `verres`/`verres a vin`/`verres de degustation`, `magazine`,
  `bec verseur`, `accessoires de degustation retails`, `solide` —
  **no guessed tax keys anywhere** (dropped, never landed); the
  whisky+book bundle (`BUNDLE_ARMORIK_LIVRE…`): no usable strength or
  volume → `Held for review … ABV is unparseable but the name resolves to
  an alcohol category` — the hygiene hold; +1 data-quality zero-volume
  note on that held row.
- **Landed state**: `retail_offers` lmdw **29 rows / 29 distinct
  products** — `product_master` 47 → **76** (ids 9003–9031 contiguous),
  single batch 19:41:19.191Z (28 rows) + .193Z (the held row), min 1,790 /
  max 599,000 c, single FR / EUR / `in_stock`, all reliability
  **ESTIMATED** (every merchant's local runs land ESTIMATED — the
  araxes/BOI/kuhns precedent).
- **ABV/volume from the page extraction**: 28/29 landed rows carry both
  `alcohol_by_volume` (decimal fractions 0.12–0.80) and `unit_volume`
  litres (0.7/0.72/0.75) — litres land as litres (0.7), percent ÷ 100
  (`"strength":40` → 0.40). Categories: spirits (incl. cask-strength
  STROH 80 0.80, ARDBEG Corryvreckan 0.571), other_fermented ×3 (sakes —
  the 2.1 sake keys working), intermediate_products (Byrrh, Pommeau,
  Niepoort ports), wine_sparkling ×3 (Taittinger, Billecart-Salmon ×2).
- **EAN/GTIN state as measured**: 28/29 = **96.6 % of landed products
  carry page-attested EANs** (the extractor's GS1 check digit applies;
  e.g. ABERFELDY 5000277000982 — a probe-sampled value); the bundle row
  is the one EAN-less product (held). The chunk-1 walk measured 259/261
  = 99.2 % on its spirits-heavy slice — above the 73.3 % whole-sitemap
  probe share, slice-dependent as expected; the remainder rides the
  accepted no-fabrication path.
- **Live spot-checks** (read-only GETs, crawler UA):
  `aberfeldy-12-ans.html` → `"volume":"0.7"`, `"strength":40` ↔ DB 0.40 /
  0.7 L ✓; `stroh-80.html` → `"strength":80` ↔ DB 0.80 / 0.7 L ✓.

### Run r3 — repeat-run idempotency

Watermark lowered again by **8 of the just-upserted locs** (glenlivet-21,
aberfeldy-12, monkey-shoulder, stroh-80, koi-koi, byrrh-grand-quinquina,
niepoort-tawny, taittinger-brut); instance
`price-ingestion-lmdw-2026-10-08-r3` 19:44:53Z:

- `crawl-discover-1`: `queueLength` 8 → 8 records re-crawled from the
  live pages → **`upsert-offers-1-1`: recordsAdded 0, recordsUpdated 8,
  offersChanged 0, zero upsertErrors** — the compound-key + EAN tiers
  matched all 8 to their existing product rows (ids 9003… reused),
  unchanged prices → no offer-change fire.
- **`product_master` 76 / max id 9031 — byte-identical, zero duplicate
  rows** ✓. `retail_offers` 29 → 37: the append-only observation history
  added a third `observed_at` batch (19:45:06.129Z × 8, same prices) —
  offer history grows, the product dimension does not.
- R3's 8 record URLs verified as true re-crawls (all 8 productIds ⊆ r2's
  set; GLENLIVET 21 price 27,200 c identical across both runs).

### ESTIMATED share vs the probe

On the bounded r2 sample, 28/29 landed records (96.6 %) carry BOTH
page-extracted ABV and volume — the probe's guarded-parse rates were
strength 95.7 % / volume 98.3 % usable on a 300-page stride; same
population, same behavior (the unusable minority rode correction or the
hold, never a guess). The 1-row landed-but-unusable population is held
(`nonalcoholic_in_alcohol_category`) and ESTIMATED — invisible to
user-facing surfaces per the hold rule.

### Final state + cleanup

`aggregation_watermarks` = exactly 1 row (`sitemap-crawl-lastmod-lmdw`,
6,834 entries after the two recorded lowerings; the cursor row absent —
cycle closed, the steady-state shape). Dev worker stopped (port 8787
free); scratch files removed. Working tree carries only this notes
section; the untracked `openspec/changes/add-de-fi-consumer-carriers/`
untouched; nothing committed.

### Blockers / notes for the lead

1. **Local workflow engine does not auto-resume a mid-step-killed
   instance**, and the Local Explorer `restart` action re-runs from the
   top rather than replaying cached step outputs (run 1's 600 walked
   records were never upserted — the bounded completing runs went
   through fresh instances instead). Staging 6.2 uses the real Workflows
   REST API and engine, so this is a local-dev-only caveat for future
   bounded runs: stop between chunks only when planning to re-drive, and
   treat `PATCH …/status {"action":"restart"}` as a fresh re-run.
2. The bounded-run mechanics (one cursor deletion, two recorded watermark
   lowerings) are local-only operator measures. No staging/production
   crawl ever lowers the crawl watermark by hand — the daily cadence +
   lastmod diff is the convergence mechanism, and r2/r3 demonstrate that
   convergence behavior end-to-end on a bounded set (diff → small queue →
   drain → upsert → steady state).

## 6.1 PR + merge evidence

**MERGED — staging auto-deployed green (2026-10-08).**

- PR: [#109](https://github.com/siimliimand/rajahinta-fi/pull/109)
  (`feature/onboard-lmdw-crawl-merchant` → `master`), merged with a
  merge commit: **`321aa9d48974c81f1d570ced7351b6b245d8c54b`**.
- First CI round failed on one deterministic, code-level item:
  `tests/integration/d1/crawl-producer-parked.d1.test.ts:65` —
  `expected 12 to be 11` (D1 suite + Integration + the `ci-pass` gate;
  17 other checks green). The 4.2 lmdw registry seed row grew the
  bootstrap registry to 12 rows, and this producer test still hardcoded
  the pre-lmdw counts. lmdw carries a feedUrl but deliberately NO seed
  governance row (the GRANT is 6.2's ops-console step), so the
  fail-closed producer counts it as not-permitted, not enqueued.
- Fix-forward commit **`b50da70`** (test-only, no production code):
  `merchants` 11→12, `skippedNotPermitted` 4→5, comments updated;
  `enqueued` stayed 4, enqueued merchantIds unchanged. (The sibling
  `d1-seed.test.ts` enumeration was already updated in 4.2 — only this
  file was missed.)
- Re-run CI: **all 31 checks SUCCESS** (`mergeStateStatus: CLEAN`) —
  unit, e2e, browser-e2e, build, lint, worker checks, wrangler config,
  content policy, data-quality, golden-dataset, compliance, composition
  smoke, load test, **D1 suite** and **Integration** now green
  (Artillery staging suite skipped by design). Runs 37837653382 (push)
  + 37837659485 (PR).
- Staging auto-deploy: `deploy-staging.yml` run
  **37838714509** on the master push of the merge commit — **success**
  in 2m50s, including `Health gate — staging readiness` ✓ (jobs:
  migrations → seed → API/email/frontend Worker deploys → health gate).

## 6.2 Staging rollout evidence

**EXECUTED 2026-10-08 20:27–20:57 UTC — registry verified, grant audited, first crawl
triggered and walking; D6 egress smoke PASSED mid-walk. The instance is honestly
STILL RUNNING at the ~26-minute observation cap (13 steps, cursor offset 900/6,842,
offers 0 by design — the walk accumulates all chunks before map/upsert), so the
offer-count / EAN-share / API-page numbers below are recorded as pending with the
completion checklist; no numbers were invented.** Staging only — zero production
contact, zero writes to staging D1 outside the audited console API. Staging ingestion
is manual-only (producer cron dropped from the env, wrangler.jsonc 2026-10-07), so the
first crawl rode a manual Workflows-API instance; there is no staging producer to
observe.

### Registry row (seeded by the 6.1 deploy) — verified

Read-only staging D1 (`--remote --env staging --json`): **`lmdw` / La Maison du
Whisky / FR / feedUrl `https://www.whisky.fr/media/sitemap/sitemap_whimag.xml` /
`xml` / 86400000** — fields exact vs the 4.2 seed row; registry 15 rows total.
Pre-grant baselines: lmdw governance rows 0, lmdw `retail_offers` 0, lmdw watermarks
0, total offers **119,431** and `product_master` **9,621 / max id 9,621** — byte-equal
to the archived pair's 6.2 end state (no other merchant moved since).

### Pre-grant state (fail-closed, §0)

`GET /ops/console/governance` (bearer `$(cat /root/.ops-token)` inline, never
echoed): 15 merchants, **`lmdw` `PENDING` / `sourceCount: 0`** with the exact
feedUrl read back — the 6.1 seed row (deploy run 37838714509) with no governance
records, exactly the fail-closed contract.

### Grant (runbook §2.2 audited console action)

`POST /ops/console/governance/lmdw/grant` — `operator: "siim (owner)"` (the
audit-trail convention), `acquisitionMethod: "RETAILER_API"`, `sourceUrl:
https://www.whisky.fr` (the crawl source root, matching the Shopify pair's grant
shape), note "owner blanket permission policy — change onboard-lmdw-crawl-merchant
task 6.2". Result: **`permissionStatus: "GRANTED"`, `changed: true`**. Audit verified
(`GET /ops/console/audit?limit=4`): **exactly one entry** —
`source_governance`/`lmdw`/`created`, id **`3f450dda-ed87-40f3-8ca3-4fa4b5187760`**,
author `siim (owner)`, **2026-10-08T20:27:36.382Z**, reason exact (single entry
because lmdw had no prior governance records — the grant registers one directly as
`GRANTED`; the seeded registry row was untouched, so no `merchant_registry` entry).
Governance re-check: **`lmdw` `GRANTED` / `sourceCount: 1`**, 15 merchants total.

### First crawl via the Workflows REST API (archived 6.2 call shape)

- `POST /accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances`,
  body id/params `price-ingestion-lmdw-2026-10-08-20` with `{"merchantId":"lmdw",
  "sourceUrl":"https://www.whisky.fr/media/sitemap/sitemap_whimag.xml","dedupeKey":
  "price-ingestion-lmdw-2026-10-08-20"}` (params mirror the producer message — the
  sitemap URL is the crawl source) → uuid **`986f879b-0fed-4261-932a-a54785196820`**,
  `queued` ~20:28:35Z.
- `resolve-merchant-1`: config exact (lmdw / FR / feedUrl / xml / 86,400,000).
  `governance-gate-1`: **`{"permitted":true,"status":"GRANTED"}`** — the pipeline
  gate honored the grant.
- `crawl-discover-1`: **`{"queueLength":6842,"resumed":false,"errors":[]}`** — the
  probe's product-shaped count exactly, full diff on the first cycle.
- **Both D1 rows written at begin, cursor-first order (20:28:36.804Z / .389Z)**:
  `sitemap-crawl-cursor-lmdw` (**421,255 bytes** — `{queue: [6,842 URLs], offset: 0}`)
  and `sitemap-crawl-lastmod-lmdw` (**612,810 bytes** — 6,842 `loc → lastmod`
  entries) — byte-identical sizes to the local 5.1 walk (same sitemap, same filter).

### D6 Workers-egress smoke — PASS (mid-walk, no Posti playbook)

The first real whisky.fr fetches from Cloudflare IPs happened inside this instance:
**chunk steps produced mapped records** — chunk-1 opens FAMOUS GROUSE (The) Litre
(`alcoholByVolume 0.4, volumeMl 1000, ean 5010314101015, 2590¢ EUR, in_stock,
sourceUrl …/famous-grouse-the-litre-1213.html`) and BALLANTINE'S Finest 200 cl
(`0.4 / 2000 ml / ean 5010106112854`). **Zero HTTP 403 and zero challenge shape on
any fetched page** — the Posti blocked-egress pattern did not materialize; per D6 the
fetching itself (queueLength > 0 → records landing) IS the smoke, and the crawl UA is
the measured-good shape. No retry loop was run. Live spot-check (read-only GET,
crawler UA): `famous-grouse-the-litre-1213.html` → **HTTP 200**, `__NEXT_DATA__`
carrier, `"volume":1` / `"strength":40` / `gtin13 5010314101015` ↔ the crawl record's
0.4 / 1000 ml / 5010314101015 — **the page→record litres→ml ×1000 and percent→÷100
conversions verified on live staging-walk data** (probe 1.1 arithmetic, now
end-to-end).

### Progress at the observation cap (honest: still running)

Last observation **20:54:52Z (~26 min in)**: instance **`running`**, **13 steps** —
`crawl-chunk-1-1` → `crawl-advance-1-1` → `crawl-chunk-2-1` → `crawl-advance-2-1` →
`crawl-chunk-3-1` → `crawl-advance-3-1` done, `crawl-chunk-4-1` running. **Cursor
offset 900** (300 per chunk; measured pacing ≈ **1.73 s/page** = 900 fetches in
~26 min, the polite ≤300-fetch D5 cap holding). **`retail_offers` lmdw: 0** — by
design: the chunked walker accumulates ALL records before the map/gate/upsert stages,
so offers land only at walk end. Full-walk arithmetic: 6,842 × 1.73 s ≈ **3h17m from
trigger → completion expected ~23:45–00:05 UTC** (23 chunks; `CRAWL_MAX_CHUNK_STEPS`
400 ≫ 23). The active-wait cap (~25 min) was honored; polling stopped, the instance
keeps running autonomously (durable chunks — no operator action needed).

**Pending at cap, verifiable on the completed instance (no invented numbers):**
`productsIngested` + the collected-error census (the Workflows API truncates step
output ~1 KB mid-run, so the census comes from the final output), offer counts +
batches, EAN share vs the ~73 % probe band, correction rows for the
deliberately-unmapped labels (`verres`, `magazine`, `AUTRES ALCOOLS SUCREES`, …),
ESTIMATED share in the probe band (strength 95.7 % / volume 98.3 % usable → the
unusable minority rides correction/hold, never a guess).

### Public staging API + product pages — pending the walk's upsert

lmdw has 0 offers until the walk's upsert fires, so: `GET
/api/v1/merchants/reliability` carries no `lmdw` row yet (pre-existing merchants
unchanged); no lmdw product ids exist yet → no product page to serve. Both checks are
checklist items below (the archived 6.2 endpoint shapes: bare → 403 age-gate,
`x-age-confirmed: 1` → offer; `/products/<id>` HTTP 200 with the `Katso kaupassa`
CTA).

### Scheduled-boundary checklist — completion ~00:00 UTC, then the daily cadence

The registry cadence is daily (86,400,000 ms). **Staging has no producer** (cron
dropped 2026-10-07): the 00:00 UTC *enqueue* item applies to PRODUCTION (task 7.2 —
first hourly tick of the UTC day, dedupeKey `price-ingestion-lmdw-2026-10-09-00`,
exactly one message, no duplicate instances). In staging the convergence mechanism is
(a) THIS instance completing autonomously, then (b) the next manual Workflows-API
instance diffing the refreshed watermark — the lastmod behavior measured locally
(6,842 → 0 unchanged → only-changed queue; local runs r2/r3). Operator observation
checklist, recorded 2026-10-08T20:57Z:

- [ ] Instance `986f879b…` (`price-ingestion-lmdw-2026-10-08-20`) reaches **`complete`**
      with `error: null` ~23:45–00:05 UTC; exactly ONE instance for this first pass (the
      queue-consumer handoff path is not exercised in staging — no producer — so no
      second instance may appear).
- [ ] **Offers refreshed**: fresh `retail_offers` lmdw batches at `observed_at` ≈ the
      upsert time; reconciliation `fetched ≈ ingested + correction/hold drops` exact;
      zero guessed categories (every dropped page names its source labels).
- [ ] **EAN share** in the ~73 % probe band; **ESTIMATED** reliability for the
      unverified minority per the hold rule; correction rows present for the
      deliberately-unmapped labels; the ~1.6 % CMS pages ride the guarded path.
- [ ] **API + pages**: `GET /api/v1/products/<max-price-id>` bare → 403, with
      `x-age-confirmed: 1` → the lmdw offer (decimal ABV fraction + litres);
      `GET /api/v1/merchants/reliability` shows the lmdw offerCount (expected
      `governancePermissionStatus` read-model artifact "PENDING" despite the GRANTED
      row — kippis/mydrink/araxes/BOI precedent, record not chase);
      `rajahinta-frontend-staging…/products/<id>` HTTP 200 with the offer row + CTA.
- [ ] **Post-completion steady state**: a later manual staging instance re-diffs the
      watermark → near-zero queue (lastmod skip) — the daily-cadence convergence
      demonstrated end-to-end (local r2/r3 precedent, now on staging data).
- [ ] Check commands: instance GET on
      `/accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances/
      986f879b-0fed-4261-932a-a54785196820` (Cloudflare API token inline, never
      echoed); read-only `npx wrangler d1 execute DB --remote --env staging --json
      --command "SELECT … FROM retail_offers WHERE merchant='lmdw' …"` +
      `aggregation_watermarks` census; the curl set above.

### Commands executed (names)

`npx wrangler d1 execute DB --remote --env staging --json --command "…"` read-only
(registry read-back, baselines, watermark/cursor/offer polls; `CLOUDFLARE_API_TOKEN=
"$(cat /root/.cloudflare-token)"` inline, never echoed) · `curl GET/POST
$STAGING_API_URL/ops/console/governance|governance/lmdw/grant|audit?limit=4`
(bearer `$(cat /root/.ops-token)` inline, never echoed) · `npx wrangler whoami
--json` (account id captured same-invocation, never emitted) + `curl -X POST
/accounts/{account}/workflows/rajahinta-price-ingestion-staging/instances` + instance
polls ×3 (instance JSON to `/tmp/opencode` scratch, deleted) · read-only `curl
-A "rajahinta-crawler/1.0 (+https://rajahinta.fi)"` of one live product page
(spot-check). No hand writes against staging D1; grant only through the audited
console API; no production contact; nothing committed.

**Verified at**: 2026-10-08T20:57Z (grant audit 20:27:36Z, instance running at cap —
completion + landing = the checklist above).

## 7.1 Production deploy evidence

TBD (run id, health gate)

## 7.2 Production rollout evidence

TBD (registration audit entries, first crawl outcome — honest about
throttling if any, next-scheduled checklist)

## 8.1 Verification evidence

TBD (suite table, consolidated pointers, hold-rule note, correction-noise
observation)

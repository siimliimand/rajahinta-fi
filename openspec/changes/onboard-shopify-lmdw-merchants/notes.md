# Onboard Shopify and LMDW merchants — Notes

> Operator/engineer log. Probe measurements below are from the 2026-10-07
> exploration (this host, read-only GETs). Sweep numbers (tasks 1.1–1.3) are
> filled by whoever runs the sweep — never pre-filled. TBD placeholders are
> filled by the operator only.

## Probe baseline (2026-10-07)

- bottleofitaly.com: Shopify, EUR (cart.js), page 1 @250 full, gradazione-tag
  ABV 250/250, volume-in-title 98/250, barcodes 0/250, grams 250/250,
  product_type: Olio 90, Spirits 67, Vino Rosso 44, Vino Bianco 21, Aceto 12,
  Bollicine 12, Vino Rosato 4. Shopify-side 429 observed after ~6 rapid calls.
- kuhns.shop: Shopify, EUR (cart.js), title forms `alc. 12 Vol.-%` + `0,75l`
  (comma decimals), product_type `Wein`, vendor `Kuhns Trinkgenuss`,
  SKU `ML9500`-shaped (no EAN), grams present.
- gateway.prod2.whisky.fr: Magento 2 GraphQL (LMDW), EUR per-item, filter-less
  products queries rejected (French error), `category_id: "3"` walk = 3,213
  products, ABV in `short_description.html` (`45,8%`, `à 52%`), volume not
  located, `m3_family` clean taxonomy (`rhum`…), SKU numeric, no weight seen,
  `custom_attributesV2` internal-server-errors on probed products.

## 1.1 bottleofitaly sweep results

Sweep run 2026-10-08T06:02Z (verified-at; this host, read-only GETs,
`scripts/bottleofitaly-catalog-sweep.ts`, sequential `?limit=250&page=N`
at 5 s pacing, short-page termination):

- **Catalog: 22,937 products / 23,039 variants over 92 pages**; short-page
  stop at page 92 (187 < 250); 0 page failures, 0 duplicate product ids.
  Run 1 hit the planned 60-page hard cap with 15,000 full pages and 0
  failures — the catalog is far larger than the probe implied — so the
  bound was raised to 120 pages (still a hard bound, never unbounded);
  deviation from the task text, flagged here for the lead.
- **429 behavior: zero 429s and zero non-JSON (local rate limit) bodies
  across both runs (152 sequential requests)** at 5 s pacing — the 30 s
  single-retry path never fired; the deprecated `page` param worked to
  page 92 in practice.
- product_type census: Spirits 7,616 (33.2 %), Vino Rosso 6,128 (26.7 %),
  Vino Bianco 3,668 (16.0 %), Bollicine 3,064 (13.4 %), Altro 713 (3.1 %),
  Vino Rosato 434 (1.9 %), Olio 430 (1.9 %), Birra 378 (1.6 %), Gadget 320
  (1.4 %), Aceto 171 (0.7 %), plus singles/strays: `Vino` 11, missing 2,
  lowercase `Vino bianco` 1, `Buoni regalo` 1.
- **Merch share (Olio+Aceto): 2.6 % (601) — not the ~36 % the page-1
  probe suggested** (page 1 was Olio-skewed, 90/250). Design D8's "~40 %
  merch share" premise is stale: merch correction rows are ~600/run.
- Tag-ABV share: 21,255 (92.7 %). Page-1's 100 % was a spirits+merch skew;
  wine carries `custom-gradazione-XX-X` tags too, so ABV coverage is
  near-total for beverages.
- Title-volume: 8,563 (37.3 %; the probe's 39 % page-1 read holds at
  scale). Fallback outcomes over the 14,374 title misses: **whole-tag
  volume (`150cl`-shaped tag — discovered this sweep) 1,638 (7.1 %)**;
  variant title 2 (0.0 % — variant titles are `Default Title`);
  description 216 (0.9 %); **no token anywhere 12,518 (54.6 %)** — mostly
  wine with no volume in any products.json field, plus Olio merch
  `1Lt`/`5Lt` forms the spec regex intentionally does not match (`Lt`
  fails the word boundary; merch drops by category anyway).
- ABV×volume matrix: both 9,280 (40.5 %), ABV-only 11,975 (52.2 % — wine),
  volume-only 1,139 (5.0 % — merch), neither 543 (2.4 %). ESTIMATED-by-type:
  Spirits 7.5 %, Birra 6.6 %, wine 82–90 % (ABV present, volume absent).
- Variant coverage: barcodes **0** (probe confirmed at full scale); SKU
  99.8 %; grams 99.7 %; prices 23,039/23,039 parseable decimal strings;
  vendor 100 %.
- **GO for task 3.1.** Promote tag-ABV + title-volume with the
  sweep-discovered tag-volume fallback (whole-tag `/^(\d+[.,]?\d*)\s*(cl|ml|l)$/i`).
  Design D2's fallback question is answered: variant title and description
  are dead ends; wine's volume has no products.json source → honest 0 ml +
  ESTIMATED per the alks precedent. Watch-item for the lead (out of 3.1
  scope): 22,937 EAN-less rows means the D8 correction-noise budget
  (~araxes's 1,630 lines/run) is exceeded by ~14× if every row logs a
  correction per run.

## 1.2 kuhns sweep results

Sweep run 2026-10-08T06:02Z (verified-at; this host, read-only GETs,
`scripts/kuhns-catalog-sweep.ts`, same walker, 5 s pacing):

- **Catalog: 2,012 products / 2,013 variants over 9 pages**; short-page
  stop at page 9 (12 < 250); 0 page failures, 0 duplicate ids, 0 429s,
  0 non-JSON bodies.
- **Category census: `product_type` is empty on 93.7 % of rows (1,885).**
  Typed rows: Whisky 68, Rum 12, Likör 9, Wein 8, Bier 4, Vodka 4,
  Bio Direktsaft 3, Apfelwein 3, Gin 2, Bundle 2, Iced Tea 2, Apfelsaft 2,
  and singles incl. `champangne` [sic], lowercase `whisky`, `calvados`,
  `wasser`, `Limo`, `Portwein`, `Tequila`, `giftbox_ghost_product`. The
  probe's `Wein` impression was page-1 skew. Raw rows carry no Shopify
  `category` field, and untyped rows carry no tags — **the 2.2 DE
  exact-key vocabulary can only ever hit ~6 % of kuhns rows; kuhns
  classification must ride on title-based inference** (3.2 implication).
- ABV parse (strict `alc. N Vol.-%`): 1,912 (95.0 %). 40 of 1,952
  vol-mentioning titles yield no ABV: forms the strict pattern misses
  (`alc. 40 Vol.` (no `-%`), `63,5 Vol.-%` (no `alc.`), `alc 36 Vol.-%`
  (no dot)), **range forms (`4,9/6,0`, `40,5-46`, `15-17`, `20/40`) that
  cannot be honestly single-valued — 3.2 decides first-value vs
  ESTIMATED**, and `alc. 0,0 Vol.-%` (pattern-matched, rejected by the
  ABV > 0 value filter — non-alcoholic, honestly ESTIMATED).
- Volume parse: single token 1,918 (95.3 %) + multipack 73 (3.6 %) =
  98.9 %. Multipack forms are Adventskalender-shaped (`24x0,02l` → 24 ×
  20 ml; also `24x0,44l`, `25x20ml`). Misses (21, 1.0 %): unitless `0,7`
  forms, `1,0 Ltr.` (word boundary), event tickets, Bag-in-Box.
- **ESTIMATED share (ABV or volume unparsed): 109 (5.4 %)** — ABV 5.0 %,
  volume 1.0 %, both 0.6 %. By type: (missing) 4.7 %, Whisky 5.9 %.
- Variant coverage: barcodes 0; SKU 100 % with **zero bare-13 EAN-shaped**
  (`ML9500` internal codes at full scale → all kuhns rows ingest EAN-less);
  grams 99.2 %; prices 2,013/2,013 parseable; vendor 100 % but **mixed**
  (`Kuhns Trinkgenuss`, `Kuhns-onlineshop` plus real brands
  `Hendrick's`, `Talisker`, `Dalwhinnie`, …) — D2's "vendor is the brand"
  holds only partially for kuhns.
- **GO for task 3.2.** German title parsing is proven at 95.0 % ABV /
  98.9 % volume / 5.4 % ESTIMATED. Non-blocking decisions for 3.2:
  range-ABV policy, unitless `0,7` / `Ltr.` title forms, and the category
  source (title inference; the 2.2 DE keys stay additive and cover only
  the typed minority).

## 1.3 LMDW sweep + spike decision

Sweep run 2026-10-08T06:34Z (verified-at; this host, read-only GraphQL POSTs +
GETs, `scripts/lmdw-catalog-sweep.ts`, sequential `pageSize: 100` over the
mandatory `filter: { category_id: { eq: "3" } }`, 3 s pacing, bounded
retry-once-after-30 s, `sku` dedupe, hard cap 75 pages):

- **Catalog: 6,814 distinct skus over 69 pages (69/69 ok, 0 page failures,
  0 duplicate-sku rows, 0 sku-less rows)**. `total_count` declared 6,821 →
  delta 7 (drift warning, mydrink X-WP-Total precedent — every declared page
  was fetched; the last page ended the walk per `page_info.total_pages`).
  **The probe's 3,213 is stale**: the live total_count is 6,821 (and the
  packaging category 76 → 256) — the LMDW catalog changed between the
  2026-10-07 probe and this sweep (new "Les Anthologistes : Collection
  Créations 2027" categories are live). The planned 60-page cap could not
  cover the walk, so it was raised to 75 (still a hard bound, never
  unbounded) — the bottleofitaly 1.1 precedent, flagged here for the lead.
- **ABV share of `short_description.html`: 699 of 6,814 = 10.3 %** with the
  boundary-guarded French `%` pattern `(?<!\d)(\d{1,2}[.,]\d{1,2}|\d{1,2})\s*%`.
  Cross-checks: the task text's unguarded pattern matches 949 — the delta 250
  are tail-of-larger-number artifacts (`100% agave` → `00%`; run 1's unguarded
  top value was literally `00%×276`, which forced the guard); decimal split
  comma 168 / dot 59 / integer 472; 385 rows (5.7 %) have an empty
  short_description. The probe's "ABV everywhere" impression was page-1 skew
  (the same trap as bottleofitaly's merch share): the long descriptive copy
  (`PROFIL : …` format) usually omits the degree.
- **Volume hunt (D5 priority order) — no feed-side source exists**:
  1. `lmdw_label`: introspected (`{ active_from, active_to, id, name,
     priority, settings, tooltip }` — marketing labels); **0 of 6,814 rows**
     carry a volume token in any label name; 20-row sample printed (mostly
     no labels at all). Dead end.
  2. Name suffixes: **174 rows (2.6 %)** — explicit `cl`/`ml` 163 (2.4 %,
     mostly coffret/calendrier multipacks `25 x 2cl`), litre decimals 2,
     unitless `0,x` 9. Dead end as a primary source.
  3. Packaging category 2841 ("Type de conditionnement"): 256 skus, all 256
     inside the walk (**3.8 % overlap**) — a cross-reference, not a per-row
     source.
  4. **Sampled product pages: 10/10 volume extracted (100 %)** via
     `https://www.whisky.fr/<url_key>.html` (no lmdw.com fallback needed;
     HTTP 200 under the honest `rajahinta-crawler` UA) — the pages embed a
     state JSON with **`"volume":"0.7"` (litres, dot decimal)** and render
     `data-lmdw-el="volume">70cL`; **`"strength":55.6` (ABV) is in the same
     payload, 10/10**. Highest measured coverage — but a per-row crawl
     (~6,814 GETs/run), not a field of the GraphQL feed: the introspected 76
     `ProductInterface` fields contain **no volume/ABV/strength field**
     (`custom_attributesV2` stays rejected per the probe — internal server
     errors).
- Side-probe (not in the walk): the full `description { html }` field carries
  ABV for **0.5 % of a 400-row stratified sample** — also a dead end, so
  `short_description` is the only feed-side ABV text at all.
- **m3_family census: 137 distinct labels** (for task 2.2's FR vocabulary).
  Top: `single malt whisky` 2,202 (32.3 %), `rhum` 653 (9.6 %), `blended
  whisky` 348 (5.1 %), `distilled gin` 270 (4.0 %), `rhum agricole` 249
  (3.7 %), `cognacs` 153, `bourbon` 133, `tequila 100% agave` 123, `autres
  spiritueux` 112, `BOISSONS SANS ALCOOL` 110, `calvados` 106, `london dry
  gin` 99, `mezcal` 95, `bitters cocktails` 88, `armagnacs` 87, `liqueurs
  herbales` 85, `autres liqueurs` 83, `vodka de cereale` 81, `rhum pur jus de
  canne` 69, `liqueurs de fruits` 67. Non-beverage terms exist inside the
  taxonomy and must stay deliberately unmapped: `BOISSONS SANS ALCOOL`,
  `sodas`, `ale`, `vins tranquilles`, `magazine`, `verres de degustation`
  (glassware), `porto`. `m3_division`: `liquide` 6,666 (97.8 %) / `solide`
  146 (2.1 %) — the merch split.
- **Currency: EUR×6,814, zero non-EUR, zero unparseable prices** — the D5
  EUR premise holds at full scale.
- Anomalies: `gift_box` census (packaging presentation, not product type):
  `sans` 3,897 (57.2 %), `etui` 1,732 (25.4 %), `tube` 246, `coffret` 157,
  `cof.bois` 126, plus rarities down to `valise`×3 and `coffret 6x70cl`×2
  (the only volume-bearing label, 2 rows). `stock_status`: IN_STOCK 89.4 % /
  OUT_OF_STOCK 10.6 %.

**Decision — NO-GO for task 3.3 (design D5's third accepted outcome):**

- **Volume-source decision:** the only measured source is the product page's
  embedded state JSON (`"volume"` in litres + `"strength"` ABV, 100 % on 10/10
  samples at whisky.fr) — a crawl-scale extraction, not a GraphQL feed field.
  Every feed-side candidate measured dead: `lmdw_label` 0 %, name suffixes
  2.6 %, packaging category 3.8 % cross-reference. A future LMDW follow-up is
  the sitemap-crawl merchant pattern (licorea precedent: per-page GET of
  `https://www.whisky.fr/<url_key>.html`, read `"volume"` state JSON, litres →
  ml), not the design's `LmdwFeedAdapter`.
- **ABV share is not high enough to ride ESTIMATED:** 10.3 % in
  `short_description` — with the live hygiene hold rule, a feed adapter lands
  ~90 % of 6,814 rows ESTIMATED and held from user-facing surfaces, and there
  is no volume source to pair with it; the compound-key convergence argument
  behind D5's GO-with-ESTIMATED-volume does not apply. The walk itself is
  proven (69/69 pages, EUR-clean, `m3_*` taxonomy clean) — only the ABV/volume
  extraction fails the gate.
- **NO-GO defers the LMDW adapter tasks** (3.3, and 3.3's shares of 4.1/5.1/
  6.2/7.2) to a follow-up **while the Shopify pair proceeds** (3.1/3.2 both
  GO). Task 2.2 can still land the `m3_family` FR keys from the census above —
  they are additive and gate nothing until an LMDW source exists.
- Honest TBD for any future re-plan: a full-catalog page-crawl coverage check
  (the 10-row sample measured 100 %, but a crawl design needs its own sweep
  before any adapter work).

## 2.2 Mapper re-sweep drop rates

Re-sweep run 2026-10-08T07:33Z (verified-at; this host, read-only GETs; both
scripts re-run sequentially after the 2.2 vocabulary landed — BOI finished
07:24Z, kuhns 07:33Z). Both walks reproduced the 1.1/1.2 censuses exactly
(BOI 22,937 products / 92 pages / 0 failures / 0 dupes / 0 429s; kuhns 2,012
/ 9 pages / 0 failures / 0 dupes), so the before/after comparison below is
against a live, unchanged catalog.

"Drop rate" = rows whose source `product_type` yields no canonical category
from `mapSourceCategory` (correction-queue rows), measured from the fresh
census against the landed vocabulary. The sweeps' own static-list metrics
are printed for continuity; they do not exercise the mapper (scripts stay
as-is per task scope).

**bottleofitaly (22,937): category-driven drops 15,321 (66.8 %) → 1,648
(7.2 %).** Before 2.2 only `Spirits` resolved (via `normalizeCategory`).
After: Spirits 7,616 + Vino Rosso 6,128 + Vino Bianco 3,668 (+ the census's
one lowercase `Vino bianco` stray on the same key) + Bollicine 3,064 +
Vino Rosato 434 + Birra 378 = 21,289 mapped (92.8 %). The residual 1,648 is
exactly the deliberately-unmapped set → correction queue: Altro 713, Olio
430, Gadget 320, Aceto 171, bare `Vino` 11, `Buoni regalo` 1, missing 2
(merch pair Olio+Aceto = 601, 2.6 %, per the D3/D8 merch bucket). Note the
static sweep metric ("candidate vocabulary covers") reports 20,910 (91.2 %)
because the script's list predates the `Birra` key — see the deviation
flag below. Deviation flagged for the lead: `Birra` (378, 1.6 %) was added
beyond the task's literal five-key BOI list, applying the task's own
kuhns-side meaningful-volume rule to the 1.1 census — Italian beer, maps to
the existing canonical `beer`; without it 378 beverage rows drop per run.

**kuhns (2,012): typed-row category-driven drops 29/127 (22.8 %) → 17/127
(13.4 %); whole-catalog 1,914 (95.1 %) → 1,902 (94.5 %), of which 1,885
(93.7 %) are the structural empty-`product_type` bucket that 2.2 cannot
address by design** — the untyped majority rides the parser's name-token
fallback (design D3 correction, task 3.2). Before 2.2, 98 of the 127 typed
rows already resolved through pre-existing keys/`normalizeCategory`
(Whisky 69 incl. the lowercase stray, Rum 12, Likör 9, Vodka 4, Gin 2,
Tequila 1, calvados 1); the landed DE keys add Wein 8 + Bier 4 + Sekt 0
(`Sekt` is keyed per the task but measured at zero rows this census) =
110 mapped. The residual 17 typed rows are exactly the strict
deliberately-unmapped set: Bio Direktsaft 3, Apfelwein 3, Bundle 2,
Iced Tea 2, Apfelsaft 2, and singles `champangne` [sic], `wasser`, `Limo`,
`Portwein`, `giftbox_ghost_product`. The script's static Wein/Bier/Sekt
metric covers 12 (0.6 %) — census-only, not the mapper view.

FR (`m3_family`) keys from the 1.3 LMDW census were NOT landed in this
task (scope: IT + DE per the 2.2 task text); the 1.3 note keeps them
optional — they gate nothing until an LMDW source exists.

## 5.1 Local rollout evidence

Executed 2026-10-08, ~08:10–11:30 UTC. Branch `feature/onboard-shopify-lmdw-merchants`,
clean tree at start. All writes LOCAL (`wrangler d1 execute DB --local`,
`wrangler dev --port 8787 --test-scheduled` from apps/api-worker); live
**read-only GETs to bottleofitaly.com and kuhns.shop only** — the due-tick
harness deliberately withheld the other GRANTED daily merchants' messages
(araxes + the four seeded crawl merchants — and on the solo-retry ticks, one
of the task merchants) so no other store was contacted;
zero staging/production contact. Node v24.21.0 (`/root/.nvm/versions/node/v24.21.0`)
for every command — the host default v22.14.0 lacks FTS5 in `node:sqlite`
(task 4.1's environmental note). `@rajahinta/core-domain` rebuilt first
(exit 0). Nothing committed.

### One code change outside this task's touches — flagged for the lead

The shared walk's `fetch()` sent **no User-Agent**, and both Shopify edges
**hard-403 an empty-UA client**: the first post-grant workflow pair
(`…-2026-10-09-00`) completed-with-errors at 0 records — `kuhns page 1..3
returned HTTP 403` / `bottleofitaly page 1..3 returned HTTP 403`, the
3-consecutive-failure bound firing — while host-side curl with any UA string
got 200 (then 429 under rapid fire). This is design D6's egress-fingerprint
shape, surfacing locally ahead of 6.2, and it defeated the task's core
verification. With the lead's approval (asked mid-task): `shopify-products.walk.ts`
now sends `user-agent: CRAWLER_USER_AGENT` (`rajahinta-crawler/1.0
(+https://rajahinta.fi)` — the sitemap-crawl constant) on every page request,
with a header assertion in the normal-walk test. Walk tests 11/11, full
data-acquisition suite **592/592**, package `tsc --noEmit` clean. **These two
files (`shopify-products.walk.ts`, `shopify-products.walk.test.ts`) are the
lead's to review/commit** — 5.1's declared touch is this notes file only.
Without it, staging 6.2's egress smoke would 403 both sources identically.

### Local D1 state found (read-only probes before any write)

Registry = alko (empty URL, id 1) + alks (2) + araxes (3) — the araxes-3.1
end state; `source_governance` = 1 row (araxes GRANTED); `retail_offers` =
araxes 3,080 (all ESTIMATED) + the seed fixture merchants; `product_master` =
**1,587 rows, max id 10542** (baseline).

### Registry + governance inserts

- **Registry rows via the seed** (4.2's rows): `pnpm --filter
  @rajahinta/data-platform exec tsx ../../scripts/seed-d1.ts --local` →
  migrations no-op, seed re-applied idempotently, **verification PASSED**.
  Read-back: **`bottleofitaly` id 4** `('Bottle of Italy','IT',
  'https://bottleofitaly.com','json',86400000)` and **`kuhns` id 5**
  `('Kuhns','DE','https://kuhns.shop','json',86400000)` — fields exact. The
  seed also brought the four crawl merchants (ids 6–9) and two empty-URL rows
  (10–11), and — pre-existing seed behavior, not this change — governance rows
  for the crawl merchants (`COMPLIANT_CRAWLING`/`GRANTED`) plus
  spritxxl/lazyshop PENDING (`source-governance.seed.ts`).
- **Governance** (no `.dev.vars` → `/ops` 403 locally → direct INSERT, the
  araxes-3.1 path; the audited console is 6.2/7.2's): `NOT EXISTS`-guarded,
  `RETAILER_API`/`GRANTED`, per-merchant sourceUrl, reason "local grant for
  first-ingest verification (task 5.1 …; local-only disposable row)".
  Read-back: **id 8 bottleofitaly → `https://bottleofitaly.com`**, **id 9
  kuhns → `https://kuhns.shop`**, all fields exact. **Local-only — disposable.**

### Producer tick + ingestion end-to-end (araxes-3.1 playbook, ×2)

1. **Pre-grant real-clock tick** (`curl
   /cdn-cgi/handler/scheduled?cron=0+*+*+*+*`): `Not scheduling merchant
   "bottleofitaly": no governance records — defaulting to PENDING` (same for
   kuhns) + `enqueued 0/11` — the §0 fail-closed contract for both.
2. **Post-grant real-clock tick**: both recognized, deferred by the daily
   interval-bucket gate — `enqueued 0/11 … (7 not due this tick)`.
3. **Due-tick harness**: temporary vitest file (deleted after the run) running
   the unmodified `schedulePriceIngestions` via `wrangler.getPlatformProxy`
   over the same `.wrangler/state`, fixed `now` at the next daily boundary
   passes, send-spy wrapping the real queue binding. Adaptation: the spy
   **delivered only the two task merchants' messages** and withheld araxes +
   the four crawl merchants (all GRANTED+daily, hence `enqueued 7`,
   `skippedNotPermitted 1` = alks, `skippedNoFeedUrl 3`) — keeping live egress
   on the two stores. Boundary ticks delivered exactly:
   `{"dedupeKey":"price-ingestion-bottleofitaly-<bucket>",…}` and
   `{"dedupeKey":"price-ingestion-kuhns-<bucket>",…}` per bucket. Consumer
   handoff lines in the dev log (`Ingesting prices for merchant … (dedupe key
   …)` → `Handed off … to Workflow instance …`) for every delivered message;
   a deliberate duplicate send of `…-kuhns-2026-10-14-00` produced
   **`Skipping ingestion price-ingestion-kuhns-2026-10-14-00: already
   processed`** — the consumer-side dedupe key contract observed (bonus).
   Note: one governance check for a *withheld* merchant once hit D1
   `SQLITE_BUSY` under the concurrent dev worker and failed closed (the
   fail-closed default under contention; enqueued 6 not 7 on that tick).
4. **Workflow-instance logs do not surface in the wrangler dev console** (the
   araxes-3.1 quoted `Fetch warnings`/`Workflow pipeline run` fragments were
   captured on a setup where they were; here the evidence channel is the
   Local Explorer API: `GET /cdn-cgi/local/explorer/api/workflows/
   rajahinta-price-ingestion-dev/instances/<id>` returns the run output
   `productsIngested` + the full per-run error list). Two wrangler-dev
   artifacts recorded, not chased: the known post-batch `Uncaught Error: …
   canceled … hung` line, and one engine wedge after the first pair (retry
   timers queued but unserviced) — a dev-worker restart resumed the durable
   instances cleanly.

### Ingestion runs (all instances `complete`; every run re-walked from page 1)

| Bucket key suffix | bottleofitaly | kuhns |
|---|---|---|
| `…-10-09-00` (pre-UA-fix) | **403 ×3**, 0 records | **403 ×3**, 0 records |
| `…-10-10-00` (post-fix) | 429 ×3, 0 records | 429 ×3, 0 records |
| `…-10-11-00` | **388 ingested** (pages 2–3 ok = 500 raw; 1/4/5/6 429) | 429 ×3 |
| `…-10-12-00` | 429 ×3 (window re-tripped by the prior burst) | 429 ×3 |
| `…-10-13-00` | **867 ingested** (pages 2–5 ok = 1,000 raw; 1/6/7/8 429) | — (withheld) |
| `…-10-14-00` | — (withheld) | **102 ingested** (page 3 ok = 250 raw; 1/2/4/5/6 429) |
| `…-10-16-00` | — (withheld) | **220 ingested** (pages 3+6 ok = 500 raw; 1/2/4/5/7/8/9 429 — page 6 recovered past the isolated failures) |

The unpaced walk (D7: sequential, no backoff — "the daily cadence is the
retry") tripped both stores' IP rate windows within ~2–4 fat pages every
fresh-window run;
pages 2–3 of bottleofitaly are the same physical pages across runs, so run
`…-10-13-00` re-ingested run `…-10-11-00`'s exact rows, and kuhns page 3 is
identical across `…-10-14-00`/`…-10-16-00`. **Partial catalogs are the
accepted evidence here** — the plumbing proof — with full-catalog convergence
riding the 24-h cadence in staging/production (design D7). The 30-min-scale
silences that let a window decay here do not exist in production.

### Workflow results + idempotency evidence (compound-key tier; no EANs anywhere)

| | bottleofitaly | kuhns |
|---|---|---|
| `retail_offers` final | **1,255 rows / 867 distinct products**, exactly two `observed_at` batches (388 @ 08:54:45.005–.006Z; 867 @ 09:30:21.027–.030Z — chunk stamps), min 35 / max 6,059,265 c, single EUR / IT / `in_stock` / **all ESTIMATED** | **322 rows / 218 distinct products**, two batches (102 @ 10:02:30.992Z; 220 @ 11:26:09.072–.073Z), min 690 / max 589,999 c, EUR / DE / **all ESTIMATED** |
| `product_master` | 1,587 → **2,454 after run 2** (+867, ids 10543–11409 contiguous); run 2's 1,000 raw = 867 ingested + 133 drops | 2,454 → **2,672 final** (+218 for kuhns across runs D+F, ids 11410–11627: +102 in run D, +116 in run F); run F's 500 raw = 220 ingested + 280 drops |
| **Repeat-run idempotency** | run `…-10-13-00` re-ingested all **388** of run `…-10-11-00`'s products by (name, brand, containerType, unitVolume) — **zero new master rows** for them; +479 = only the new page-4/5 products | run `…-10-16-00` re-ingested all **102** of run `…-10-14-00`'s page-3 products — **zero new master rows**; 118 page-6 landings produced 116 new rows (2 compound-matched existing identities — recurring rows deduped by key) |

- **Explicit no-EAN assertion**: `SELECT COUNT(*) … WHERE id > 10542 AND ean
  IS NOT NULL` = **0** across all 1,085 new master rows (867 BOI + 218 kuhns;
  BOI `custom-…` SKUs and kuhns `ML…` SKUs match no accepted EAN form — the
  sweep reality).
- `review_hold_reason`: bottleofitaly 2 rows `nonalcoholic_in_alcohol_category`
  (of 867), kuhns 5 (of 218) — the parser's non-alcoholic-ingestion guard
  stamping the machine-readable hold, matching the runs' `Held for review`
  lines (2 + 5 across each merchant's runs).
- Reconciliations (raw = ingested + dropped, per instance output): BOI run 1
  500 = 388 + 112 (Aceto 76, Olio 28, Altro 8); BOI run 2 1,000 = 867 + 133
  (Aceto 77, Olio 29, Altro 27); kuhns run 1 250 = 102 + 148; kuhns run 2
  500 = 220 + 280. **The merch pair (Olio/Aceto) is present in every ingested
  subset** — the deliberately-unmapped D3/D8 drops, riding the correction
  queue as designed.
- Correction-queue shape per run (the in-band error list): kept-without-EAN
  one per raw row (500/1,000/250/500 — 100 % of rows, the D8 noise budget
  reality), the merch/no-canonical drops above, the hygiene holds, and
  `Data error: unit_volume 0` honest-0-volume ESTIMATED wine rows (236 BOI
  run 1 / 461 BOI run 2 / 3+3 kuhns — the sweep's 54.6 %-no-volume-token
  population showing up as designed).

### API verification (local worker :8787)

- `GET /api/v1/products/10572` without `x-age-confirmed`: **403**
  (AGE_GATE_REQUIRED) ✅; with it: bottleofitaly offer — merchant
  `bottleofitaly`, IT, **6,059,265 c** (Cognac Louis XIII Rare Cask 70cl),
  EUR, `in_stock`, `reliabilityStatus: ESTIMATED`, `sourceUrl
  https://bottleofitaly.com/products/cognac-louis-xiii-rare-cask-70cl-astucciato-remy-martin` ✅.
- `GET /api/v1/products/11473` with header: kuhns offer — `kuhns`, DE,
  **589,999 c** (Macallan 30 Jahre Sherry Cask 2023 0,7l, alc. 43 Vol.-%),
  EUR, `in_stock`, ESTIMATED, kuhns.shop sourceUrl ✅.
- Ranked search `GET /api/v1/products?q=macallan`: 3 hits — two kuhns-created
  rows (brand `Kuhns-onlineshop`, category `intermediate_products`, ABV 0.43,
  unitVolume 0.7000, `lowestPriceCents` set) plus the araxes-created 9044 ✅.
- `GET /api/v1/merchants/reliability`: **`bottleofitaly` offerCount 867**,
  freshestObservedAt = run-2 batch (09:30:21.030Z); **`kuhns` offerCount
  218**, freshestObservedAt = run-F batch (11:26:09.073Z) ✅.
- R2: today's observation object in local `rajahinta-observations-dev` carries
  **867 bottleofitaly + 102 kuhns** lines — the offer-change hook fired for
  both merchants on their first changed-offer passes (§2.3 shape).

### Environment cleanup

Harness file deleted; `wrangler dev` stopped (port 8787 free); scratch JSON
files removed. Working tree now carries only the two flagged walk files and
this notes section.

### Blockers / follow-ups for the lead

1. **Walk UA header** (above) — two modified files outside this task's
   touches; needs review/commit before 6.2 (staging would 403 otherwise).
2. **D7 pacing measurement**: both stores 429 the unpaced walk within ~2–4 fat
   pages; kuhns's window outlasted 30-min silences (its full 9-page catalog
   was never ingested in one local run). This is the "sweeps or staging show
   persistent 429s" condition D7 names for the measured backoff follow-up;
   locally it bounded the evidence to partial catalogs by design.
3. Note for future local rollouts: workflow step logs don't reach the wrangler
   dev console here — instance output + error list come from the Local
   Explorer API; the run-0a engine wedge (retry timers unserviced until a
   restart) is a dev-runtime quirk worth remembering when a pair of
   concurrent workflows starts at once.

## 6.2 Staging rollout evidence

TBD (Workers-egress smoke per source, workflow instance ids, offer counts,
commands executed)

## 7.2 Production rollout evidence

TBD (registration audit entries, first-ingest counts, 00:00 UTC scheduled
checklist results)

## 8.1 Verification evidence

TBD (suites run + results, hold-rule note for ESTIMATED lmdw rows)

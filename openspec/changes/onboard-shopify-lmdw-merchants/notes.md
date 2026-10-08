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

TBD (drop rates before/after the IT/DE/FR vocabulary)

## 5.1 Local rollout evidence

TBD (per-merchant offer counts, idempotency second-run proof, correction-queue
rows observed)

## 6.2 Staging rollout evidence

TBD (Workers-egress smoke per source, workflow instance ids, offer counts,
commands executed)

## 7.2 Production rollout evidence

TBD (registration audit entries, first-ingest counts, 00:00 UTC scheduled
checklist results)

## 8.1 Verification evidence

TBD (suites run + results, hold-rule note for ESTIMATED lmdw rows)

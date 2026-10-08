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

TBD (operator fills: ABV share, volume-source decision + evidence, m3_family
census, EUR check, go/no-go for 3.3 per design D5)

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

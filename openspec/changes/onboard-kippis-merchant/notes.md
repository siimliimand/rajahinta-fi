# Change notes — onboard-kippis-merchant

(findings and rollout evidence accumulate here during apply)

## 1.1 — Catalog sweep findings

2026-09-15 · `scripts/kippis-catalog-sweep.ts` (cloned from the longero sweep; same sequential per_page=100 walk capped by the first usable X-WP-TotalPages, read-only GETs) · run via `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/kippis-catalog-sweep.ts` · result: `sweep COMPLETE — 7/7 pages, 0 page failures`.

### Walk

- X-WP-Total 677 = raw rows seen 677 (no pagination drift), pages declared 7, all fetched ok.
- Records parsed 184; rows dropped 493 → 184 + 493 = 677 (full accounting).

### Drop-rate and row-drop categories

- **72.8% drop-rate today (493/677)** — every drop is `no canonical beverage category`. Zero category disagreements, zero non-EUR/invalid-price/missing-name rows.
- 512 kept-without-EAN correction errors — every row carrying a SKU (no kippis SKU matches the current `^[a-z]{2}-\d{13}$` rule).

### Per-category error distribution (drops by raw category term)

`no-canonical-beverage-category` drop lines by the row's raw term: Valkoviinit 98, punaviinit 80, Vodkat ja Viinat 28, kuohuviinit 37, Liköörit 40, Konjakit 40, Viskit 31, Virvoitusjuomat ja mikserit 29, rommit 22, Siiderit lonkerot ja seltzerit 13, Ginit 7, Energiajuomat 21, Aperitiivit 12, uncategorized 32, Lahjakortti 4, Upsell 1. The drops are spread across **all** Finnish categories — the vocabulary gap (task 1.2) is the single driver, not one bad category. Lahjakortti (gift cards, 4) and Upsell (1) are non-beverage rows that correctly keep dropping.

### SKU/EAN gap (design D2 buckets, raw rows)

165 rows (24.4%) have no/empty SKU — EAN-less by parser design regardless of 2.1 (proposal non-goal: no image-filename recovery). Of the 512 SKUs present:

| Bucket | Rows | Share of SKUs present |
|---|---|---|
| prefixed `^[a-z]{2}-\d{13}$` (accepted today) | 0 | 0.0% |
| bare 13-digit `^\d{13}$` | 438 | 85.5% |
| GTIN-14 `^0\d{13}$` | 21 | 4.1% |
| other (stays EAN-less) | 53 | 10.4% |

- "other" holds 16 twelve-digit numerics plus internal codes (`1038480`) and suffixed EAN variants (`4740019769500/3`) — D2's no-guessing rule (no UPC-A zero-padding, no suffix stripping) keeps them in the correction queue.
- D2 shapes cover **459/512 SKUs (89.6% of present, 67.8% of all rows)** — that 67.8% is the ceiling for tier-1 EAN matching into `product_master` (design D4).
- Probe deltas: probe said 82% bare-13 / 7% GTIN-14; full catalog measures 85.5% / 4.1% of present SKUs. Total 677 confirmed.

### Multipack case pricing (`33cl x 24`)

- 103 rows (15.2%) carry a structured volume/count case name (`33cl x 24`, `24x33cl`); 115 (17.0%) any loose `x N` token.
- Of the 184 parsed records, 41 are multipack with count+volume. Median implied €/l at kept (per-container) volume: **singles 35.64 vs multipack 93.91 (2.6× skew)**; case-adjusted (÷ pack count) **4.04 €/l** — in line with singles once divided by the pack count. 35/41 multipack records imply >2× the singles median. **`prices.price` is the case price** for these rows, as the design's accepted-risk predicted.
- Sample: `Hartwall Original Long Drink Light Strawberry 4,5% 33cl x 24 tölkkiä` — 30.99 EUR → 93.91 €/l at kept volume → 3.91 €/l if case price.
- Side observation (no scope change): compact forms `33clx24` / `0,33Lx12` defeat the parser's volume regex (unit not token-final) — they drive most of the 7 ESTIMATED records (3.8% of records, 1.0% of raw rows). Data-quality-pass input.

### Finnish category-vocabulary coverage (design D3 candidates)

**All 13 candidate terms appear verbatim as exact raw category terms** — substring and exact counts are identical (no inflected/compound variants beyond the listed group terms). `mapSourceCategory` lowercases+trims before its exact lookup, so the raw terms' inconsistent casing (`Valkoviinit`, `punaviinit`, `Vodkat ja Viinat`) hits lowercase additive keys unchanged:

| Candidate term | Rows | % of raw rows |
|---|---|---|
| valkoviinit | 100 | 14.8% |
| punaviinit | 82 | 12.1% |
| vodkat ja viinat | 74 | 10.9% |
| siiderit lonkerot ja seltzerit | 60 | 8.9% |
| kuohuviinit | 54 | 8.0% |
| liköörit | 47 | 6.9% |
| konjakit | 45 | 6.6% |
| ginit | 37 | 5.5% |
| viskit | 37 | 5.5% |
| rommit | 35 | 5.2% |
| virvoitusjuomat ja mikserit | 29 | 4.3% |
| energiajuomat | 21 | 3.1% |
| aperitiivit | 15 | 2.2% |

Full raw census is 15 distinct terms — the 13 candidates plus `Upsell` (4 rows) and `Lahjakortti` (4 rows); neither gets a key.

### Verdicts

- **Task 1.2: GO** — every one of the 13 candidate Finnish terms appears as an exact live category term and the 72.8% drop-rate is driven by exactly these rows, so the additive keys land as listed (no trimming for absence; no extension beyond the list is indicated).
- **Task 2.1: GO** — bare-13 + GTIN-14 acceptance covers 89.6% of the non-prefixed SKUs (all 512 are non-prefixed), and the 10.4% residual is precisely the shapes D2 rejects (16 twelve-digit rows do not justify UPC-A zero-padding); the 165 no-SKU rows stay EAN-less per the proposal's non-goal.

Verification: script typechecked (`tsc --noEmit` with the repo's base compiler flags — no config changes) and eslint-clean before the run.

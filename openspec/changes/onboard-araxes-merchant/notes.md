# Onboard araxes merchant — Notes

> Execution log. Sweep numbers, rollout commands, and verification evidence are recorded here as tasks complete. TBD placeholders are filled by the operator only, never pre-filled.

## Sweep baseline (task 1.1)

`scripts/araxes-catalog-sweep.ts` (clone of the mydrink sweep, same walk discipline and report format) swept the live catalog read-only on 2026-10-07: X-WP-Total 1630, 17/17 pages ok at per_page=100, 0 page failures, rows seen == X-WP-Total. All 1630 raw rows went through `parseAlksStoreProducts` unchanged.

- Records parsed: 942 (57.8%); rows dropped: 688 (42.2%); 942 + 688 = 1630 ✓
- Drop taxonomy: one bucket only — "no canonical beverage category" 688 (42.2%); category disagreement, multi-product bundle, non-EUR price, invalid minor-unit price, missing name: all 0
- Drop attribution (multi-term rows count once per term): wine-led — Vein 455, Punane vein 168, Valge vein 166, Lahja alkohol 95, Vahuvein 71, Õlu 68, Alkoholivaba 65, uncategorized 17; spirits terms nearly clean (Kange alkohol 4 drops on 860 rows, Viski 0, Viin 3)
- SKU/EAN gap: 100% of the 1630 SKUs are internal 5-digit codes (samples 42631, 15238, 36625) — 0% match accepted EAN forms; all 1630 rows emit "kept without an EAN", so merges depend entirely on the upsert's compound tier
- Brand coverage: 0 rows (0.0%) carry a named `brands` entry → compound keys reduce to name + containerType + unitVolume
- Product type: 100% `type: simple` (no variable/price_range invalid-price risk)
- ESTIMATED share: 1 of 942 records (0.1%) — one ABV-unparsed name ("MINIKOMPLEK 4*0,04L …"); volume 0 ml: 0
- Category census: 42 distinct raw terms (probe anticipated 45), all bare Estonian; leaders: Kange alkohol 860 rows (52.8%), Vein 498 (30.6%), Viin 280 (17.2%), Punane vein 171, Valge vein 167, Viski 133, Lahja alkohol 131; non-beverage terms present (Suupisted 41, Karastusjook 24, Krõpsud 19, Energiajook 16, Pähklid 14, Mahl 10) are irreducible drops
- Additive `mapSourceCategory` exact-term candidates measured: kange alkohol 860, vein 498, viin 280, viski 133, lahja alkohol 131, liköör 79, õlu 76, siider 10; lonkero/romm/gin/vodka/tequila/pandipakend 0

**GO for tasks 1.2 and 2.1**: zero page failures, drop taxonomy fully explained (single bucket), 942 products ingest today, and the 688 drops concentrate in wine-family terms task 1.2 can map additively. The 100% EAN-less, 0%-brand reality is the constraint task 2.1 designs against (compound-tier merges only).

## Vocabulary re-sweep (task 1.2)

`SWEDISH_SOURCE_CATEGORY_MAP` gained 27 additive keys (mapper patch 2026-10-07, design D3), each keyed by the live census's exact spelling: the strong-alcohol parent `kange alkohol` plus the Estonian spirit nouns `viin`, `brändi`, `džinn`, `tekiila`, `kalvados`, `armanjakk`, `absint` → spirits; the still-wine leaves `punane vein`, `valge vein`, `roosa vein`, `puuvilja- ja marjavein` → wine; `vahuvein`, `šampanja` → sparkling-wine; `hõõgvein`, `vermut`, `liköörvein, portvein, šerri` → fortified-wine; `õlu` → beer; `long drink` → long-drink; the non-alcoholic section `alkoholivaba` with children `energiajook`, `karastusjook`, `mahl`, `vesi`, `alkoholivaba õlu`, `alkoholivaba vein`, `alkoholivaba vahuvein` → non-alcoholic. Census reconciliation: the design table's `tekila` never occurs — the store spells the term `Tekiila` (byte census `U+006B…`-style verified), so the key is `tekiila`; the design's merch term `Kotid` is gone from the live catalog while `Pähklid` 14 appeared. `viski`, `konjak`, `rumm`, `bitter`, `liköör`, `siider` already mapped and were not re-added — the sweep's `romm`/`gin`/`vodka`/`tequila` candidate needles matched 0 terms because the store's groups are `Rumm` (key `rumm`, already mapped) and `Džinn` (added), and it stocks no latin-spelled gin/vodka/tequila group. Deliberately NOT mapped (null at sub-22 % → correction queue): `vein` (the parent and its identically named leaf share the one lowercase key, 498 rows — first-mappable-in-payload-order would misfile Vahuvein/Šampanja rows as still wine; still-vs-sparkling excise split), `lahja alkohol` 131 (heterogeneous children resolve from their own leaves), `kokteilid` 23 (RTD spans tax families), and the merch terms `suupisted`, `krõpsud`, `pähklid`, `lihasnäkid`, `kommid`, `pakend`.

Re-sweep run: `pnpm --filter @rajahinta/core-domain build` (the sweep resolves the mapper through `@rajahinta/core-domain` dist) then `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/araxes-catalog-sweep.ts` — exit 0, 17/17 pages ok, 0 page failures, 1630 raw rows seen == X-WP-Total.

| Metric | 1.1 baseline | 1.2 (after D3) |
|---|---|---|
| Records parsed | 942 of 1630 (57.8%) | **1540 of 1630 (94.5%)** |
| Dropped: no canonical beverage category | 688 (42.2%) | 87 (5.3%) |
| Dropped: category disagreement (name vs categories) | 0 | 3 (0.2%) |
| Dropped: bundle / non-EUR / invalid price / missing name | 0 | 0 |
| 1540 + 3 + 87 = 1630 ✓ | | |

### Correction-queue remainder (87 no-canonical + 3 disagreement rows, term sets verified row-by-row)

- 62 merch rows — `Krõpsud|Suupisted` 19, `Pähklid|Suupisted` 14, `Lihasnäkid|Suupisted` 8, `Kommid` 7, `Pakend` 4: snacks and packaging, deliberately unmapped.
- 17 RTD rows — `Kokteilid|Lahja alkohol` with no other leaf: both terms deliberately unmapped.
- 17 uncategorized rows — no categories at all; nothing for the mapper to read.
- 1 bare `Vein` row — the design-expected still/sparkling-ambiguous leaf; stays unmapped by design.
- 3 disagreement rows — name implies `wine_still` while categories imply `wine_sparkling` (2) or `intermediate_products` (1): the keyed-uncertainty gate flags them instead of silently resolving (mydrink 12-row precedent).

ESTIMATED share moved with the parsed volume: 70 of 1540 records (4.5%) have an ABV the name-parsing cannot read (was 1 of 942), volume 0 ml: 4 — the wine-heavy names are the driver; the attribute-aware follow-up (design D1 escape hatch) owns it if it matters. Kept-without-EAN lines remain one per row (1630; 100% internal 5-digit SKUs, 0% brands) — the task 2.1 compound-merge constraint, unchanged.

Checks: `pnpm --filter @rajahinta/core-domain build` exit 0; mapper suite `source-category.mapper.test.ts` 66/66 (11 new araxes tests: canonical + tax key per new term, any-ABV keyword attribution for the spirits terms, the 22 % boundary on the fermented-bucket terms, bare-vs-decorated key distinctness, `vein`/`lahja alkohol`/`kokteilid`/merch non-mappings); full package suite 57 files / 1599 tests passed; eslint on both touched files clean.

## Local rollout (task 3.1)

TBD

## Staging rollout (task 4.2)

TBD

## Production rollout (task 5.2)

TBD

## Verification evidence (task 6.1)

TBD

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

TBD

## Local rollout (task 3.1)

TBD

## Staging rollout (task 4.2)

TBD

## Production rollout (task 5.2)

TBD

## Verification evidence (task 6.1)

TBD

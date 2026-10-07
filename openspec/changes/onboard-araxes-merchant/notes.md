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

**Date**: 2026-10-07, ~10:47–11:10 UTC. Branch `feature/onboard-araxes-merchant`, clean tree. All steps LOCAL (`wrangler dev --port 8787 --test-scheduled`, `wrangler d1 execute DB --local` from apps/api-worker); live **read-only GETs** to araxes.ee only; zero staging/production contact. `@rajahinta/core-domain` rebuilt first (`pnpm --filter @rajahinta/core-domain build` exit 0 — the kippis/mydrink 3.1 stale-dist lesson). Nothing committed; only this notes section touched.

**Local D1 state found (read-only probes before any write)**: the local store had been **re-seeded since the mydrink era** — registry = alko (empty feed URL, id 1) + alks (id 2, DE, daily 86,400,000), no mydrink/longero/kippis rows; `source_governance` = 0 rows; `retail_offers` = 48 seed rows, zero araxes; `product_master` = **47 rows** (baseline count; ids are sparse — match pre-existing rows by count/created range, not `id <= 47`).

### Registry + governance inserts

- **Registry row via the seed** (task 2.2's row): `pnpm --filter @rajahinta/data-platform exec tsx ../../scripts/seed-d1.ts --local` → migrations no-op (already applied), staging seed re-applied (explicit-id `INSERT OR IGNORE`, idempotent), **verification PASSED** — the seed's gate asserts `merchant_registry_araxes = 1`. Read-back: row **id 3**, `('araxes','Araxes','EE','https://araxes.ee','json',86400000)`, fields exact; alko/alks untouched.
- **Governance**: no `.dev.vars` on the api-worker → `OPS_BEARER_TOKEN` absent → every `/ops` route is 403 by design → **direct local INSERT** (the mydrink 3.1 path; the audited console path is for 4.2/5.2). `NOT EXISTS`-guarded INSERT (no unique key — kippis/longero/mydrink 3.1 idempotency pattern), `RETAILER_API`/`GRANTED`, sourceUrl `https://araxes.ee/wp-json/wc/store/v1/products`, reason "operator holds usage rights to the store API (adapter docblock, design D1); local GRANT for first-ingest verification". Read-back row **id 1**, all fields exact. **Local-only row — disposable.**

### Producer tick + ingestion end-to-end (mydrink 3.1 playbook)

1. **Pre-grant real-clock tick**: `curl /cdn-cgi/handler/scheduled?cron=0+*+*+*+*` → `Not scheduling merchant "araxes": no governance records — defaulting to PENDING` + `enqueued 0/3` — the §0 fail-closed contract observed (bonus verification; alko no-URL skip + alks fail-closed skip unchanged).
2. **Post-grant real-clock tick**: araxes recognized as permitted, deferred by the daily interval-bucket gate — `enqueued 0/3 … (1 not due this tick)`.
3. **Due-tick**: temporary vitest harness (deleted after the run) running the unmodified `schedulePriceIngestions` against real local bindings via `wrangler.getPlatformProxy` over the same `.wrangler/state`, with `now` = 2026-10-08T00:30:00Z (next daily boundary pass; tsx can't transform the cross-package decorator sources — vitest can) and a send-spy wrapping the real queue binding. Result: `enqueued 1/3`, exactly one message `{"dedupeKey":"price-ingestion-araxes-2026-10-08-00","merchantId":"araxes","sourceUrl":"https://araxes.ee"}` (asserted). Consumer handoff in the dev log: `Ingesting prices for merchant araxes (dedupe key price-ingestion-araxes-2026-10-08-00)` → `Handed off … to Workflow instance price-ingestion-araxes-2026-10-08-00` — no manual handoff needed, zero retries.
4. **Run 2**: same harness, `now` = 2026-10-09T00:30:00Z → key `price-ingestion-araxes-2026-10-09-00`; consumer handoff identical. Exactly one enqueue + one instance per key across both runs.

### Workflow results + idempotency evidence

| | Run 1 (`…2026-10-08-00`) | Run 2 (`…2026-10-09-00`) |
|---|---|---|
| `retail_offers` araxes | 0 → **1,540 rows / 1,540 distinct products**, min 75 / max 34,499 c | → **3,080 rows / 1,540 products** — fresh per-observation batch |
| `observed_at` batch | single batch 10:55:30.374Z→.410Z (36 ms-precision stamps = the upsert's chunk stamps within one step) | second batch ≈ 10:59:14.318Z |
| Value set | single EUR / EE / `in_stock` / ESTIMATED | unchanged |
| `product_master` | 47 → **1,587 (+1,540**, exact) | **1,587 — unchanged** |

- Reconciliation: 1,630 raw − 87 `no canonical beverage category` − 3 disagreement = **1,540** ✓ — the exact task-1.2 numbers. Max-price sample: `MACALLAN RARE CASK 0.7L 43% Whisky` 34,499 c on araxes-created row (araxes master ids span **9003–10542** = 1,540 rows exactly).
- **Compound-key idempotency holds**: run 2 matched all 1,540 of araxes's own rows by (name, `''` brand, containerType, unitVolume) — zero new `product_master` rows; offers re-upserted as a fresh per-observation batch (designed time-series shape; kippis/mydrink 3.1 precedent).
- **Parallel catalog (D4) confirmed**: all 1,540 offers sit on araxes-created rows (+1,540 exact — zero compound matches against the 47-row seed master; 100% internal 5-digit SKUs → no EAN join, per the adapter-docblock reality).
- Per-row correction lines (kept-without-EAN one per row, plus the 87 + 3 drops) are the adapter-deterministic D2 noise per the 1.2 sweep; the landed offer count reconciles exactly. The step-error list itself lives in miniflare's private workflow store (not decoded) — staging 4.2 observes it through the Workflows API, as mydrink 4.2 did.
- wrangler-dev artifact (recorded, not chased): right after each queue batch completed (`QUEUE rajahinta-price-ingestion-dev 1/1 (114ms)`) the dev runtime logged `Uncaught Error: … canceled … hung` — the consumer had already returned after the durable handoff; the workflow continued and every row landed (both runs), zero retries.
- R2: an observation blob containing araxes lines appeared under the local `rajahinta-observations-dev` bucket — the offer-change hook fired on the first changed-offer pass (§2.3 shape).

### API verification (local worker :8787, product **9044** `MACALLAN RARE CASK 0.7L 43% Whisky`, an araxes-created row)

- Without `x-age-confirmed`: **403 `AGE_GATE_REQUIRED`** ✅.
- With `x-age-confirmed: 1`: araxes offer — `merchant: "araxes"`, `country: "EE"`, `priceCents: 34499`, EUR, `in_stock`, `sourceUrl: https://araxes.ee/toode/macallan-rare-cask-0-7l-43-whisky/`, `reliabilityStatus: ESTIMATED`, `observedAt: 2026-10-07T10:59:14.303Z` (= run-2 batch) ✅. Product row `ean: null`, `depositSystemStatus: false` (D5) ✅.
- Merchant aggregate (product payload and `GET /api/v1/merchants/reliability`): **`araxes` offerCount 1540**, all ESTIMATED, `freshestObservedAt` = run-2 batch ✅.
- Ranked search serves araxes-created products (`q=macallan` → the id-9044 row, `lowestPriceCents: 34499`) ✅.
- Same read-model artifact as kippis/mydrink: the aggregate reports `governancePermissionStatus: "PENDING"` while the D1 row is `GRANTED` (the producer + workflow gates honored the grant) — observation recorded, not investigated.

**Environment cleanup**: harness file deleted; `wrangler dev` stopped; `/tmp` log removed. No tracked file changed except this notes section.

## Staging rollout (task 4.2)

TBD

## Production rollout (task 5.2)

TBD

## Verification evidence (task 6.1)

TBD

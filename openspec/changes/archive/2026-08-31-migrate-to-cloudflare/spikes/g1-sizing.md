# Spike G1 — D1 capacity: price observations and calculation records

Change: `migrate-to-cloudflare` · Task 1.1 · Decision D4 · Gate criterion: projected volume must fit D1 with **≥2× headroom on BOTH total bytes and row writes**; otherwise observations move to R2 (JSONL, batch-queried) while the relational core stays D1.

## VERDICT

**G1: NO-GO → R2 fallback for price_observations**

Projected 3-year database at 10× growth is **~24 GB vs the 10 GB D1 limit (0.42× headroom)**. Row writes and reads pass with margin; bytes fail under every assumption combination tested (best case 6.4 GB → 1.56×). Two findings sharpen the verdict for task 1.4 (gate review):

1. The byte pressure is **not dominated by `priceObservations` itself** (2.7 GB of 24). The dominant terms are **session-bearing `calculationRecords` retained forever** (~12.3 GB) and **`priceHistorySummaries`** (~4.0 GB). The R2 fallback as scoped in D4 (observations only) is necessary but **not sufficient** — see "Fix path" below.
2. At launch scale (1×) the 3-year projection is ~2.4 GB (4.2× headroom) and daily writes are ~40k rows — **day one is comfortable**. The NO-GO is a growth-path verdict, which is what this gate exists to catch before D4's append-only design is built as-is.

## Headroom summary (deciding scenario: 3-year horizon, 10× growth, conservative assumptions)

| Dimension | Projection | D1 ceiling | Headroom | ≥2×? |
|---|---|---|---|---|
| Total bytes | ~24.0 GB | 10 GB hard | **0.42×** | ❌ FAIL |
| Rows written/day | ~362k/day (~11.0M/month) | 50M rows/month included (Paid) ⇒ ~1.61M/day equivalent | **4.5×** | ✅ PASS |
| Rows read/day | ~10M/day (~305M/month) | 25B rows/month included (Paid) | **~82×** | ✅ PASS |

## Limits cited

Source: Cloudflare D1 docs, [limits](https://developers.cloudflare.com/d1/platform/limits/) and [pricing](https://developers.cloudflare.com/d1/platform/pricing/) (both page-dated 2026-04-21).

- Max database size: **10 GB** (Workers Paid) — "cannot be further increased". 500 MB on Free.
- Max rows per table: unlimited (storage-bound). Max row size 2 MB.
- Rows written: Workers Paid includes **50M rows/month** (then $1.00/M). There is **no hard daily write cap on Paid** — overage bills, it does not fail. The only hard cap is **Free: 100k rows/day** (writes error out past it).
- Rows read: Workers Paid includes **25B rows/month** (then $0.001/M). Free: 5M/day.
- **Each index entry counts as an additional row written** ("two rows written: one to the table itself, and one to the index"); `DELETE` also counts as a row written.
- Plan note: the target architecture (design D5) requires Durable Objects, which exist only on Workers Paid. Production is therefore Paid, and the operative ceilings are 10 GB storage + the 50M/month write allowance. The Free-tier 100k/day cap is listed only as context — though note the first-ingestion burst (~410k rows in one day, below) would exceed it.

## Assumptions (all explicit; repo-documented figures marked)

| # | Assumption | Value | Basis |
|---|---|---|---|
| A1 | Merchant registry at launch | 2 (`alko` pending/no feed URL, `systembolaget` live) | `packages/data-platform/src/seed/merchant-registry.seed.ts` |
| A2 | Polling cadence | hourly (`3_600_000` ms) | same seed file |
| A3 | SKUs per merchant | 10k central (range 4k standard assortment – 20k incl. archive/web) | **No repo figure exists** — stated assumption; the Systembolaget adapter fetches the full assortment endpoint (`systembolaget.adapter.ts`) |
| A4 | Observation write trigger | one observation per **changed** offer (price change or first sighting), never per hourly scan | `packages/data-acquisition/src/interfaces/offer-change-hook.interface.ts`: "the observation log grows with price changes, not with the full catalog on every hourly run" |
| A5 | Price changes per SKU per year | **12 conservative** (monthly-ish); realistic 2–6 (twice-yearly list adjustments + campaign rotations). Both computed. | Stated assumption — measurement proposed below |
| A6 | Assortment churn (new SKUs) | 10%/yr → first-sighting observations | Stated assumption |
| A7 | Calculations at launch / 10× | 5k/day / 50k/day (single-product + ~10% basket) | Stated; stress ceiling is 50 concurrent (`tests/load/artillery/calculator-suite.yml`), so this is ~0.06–0.6 rps avg — far below the tested ceiling |
| A8 | Share of calculations carrying a `sessionId` | **30% central** (range 5–100% computed) — the DTO field is optional and client-supplied (`calculator.controller.ts`, `calculator.dto.ts`) | Stated assumption — **the decisive unknown**, see borderline section |
| A9 | Retention | `sessionId IS NULL` rows pruned after **30 days** (`DEFAULT_RETENTION_DAYS`, `calculation-record-retention.service.ts`); **session-bearing rows are never pruned** by current code | Repo fact + schema docblock: "anonymous-session rows are pruned after the configured window" |
| A10 | Observations/summaries retention | none (append-only per D4; summaries are the retained form per `docs/tech-stack.md`: "drop raw ingestion data beyond a configurable window while retaining aggregated views") | Repo fact |
| A11 | Horizon | 3 years of append-only log growth; 10× = 20 merchants × 10k SKUs = 200k series | Task method |

## Row sizes estimated (D1/SQLite translation per design D2: timestamps → ISO-8601 TEXT ~25 B, JSONB → TEXT, enums TEXT)

| Table | Columns driving size | Row est. | Indexes | All-in/event |
|---|---|---|---|---|
| `priceObservations` | 7 INTEGERs (~24 B), merchant ~16 B, observedAt 25 B, `inputReliability` JSON ~85 B, confidence ~5 B, header ~30 B | **~220 B** | 3 secondary (`product_id+observed_at`, `merchant+product_id+observed_at`, `observed_at`) ≈ 145 B → **4 rows-written/insert** | 365 B |
| `retailOffers` (appends 1:1 with observations) | sourceUrl ~60 B, provenance ~30 B, rest ints/enums | ~250 B | 1 secondary ≈ 60 B → 2 writes | 310 B |
| `calculationRecords` | `breakdown` JSON ~300 B, `disclaimer` TEXT ~220 B, sessionId 36 B, rest ints | ~750 B | PK(id,calculatedAt) + (sessionId,calculatedAt) → 3 writes | — |
| `basketCalculationRecords` | `inputBasket` ~200 B + `shipmentBreakdown` ~500 B + disclaimer 220 B | ~1.05 KB | PK → 2 writes | — |
| `priceHistorySummaries` | 10 INTEGER cents cols + enums | ~120 B | unique bucket key + secondary → 3 writes/upsert | 220 B/row |
| `productMaster` | name/manufacturer/brand/ean + numerics | ~250 B | — | negligible (50 MB at 200k SKUs) |

Summary-bucket multiplicity: buckets exist only where observations exist (the aggregation job materializes observed buckets, so the catalog does not multiply rows). ≈ **2.5 summary rows per observation event** (per-series daily + shared product-wide daily + weekly rows, deduped within series-day/week).

## The math

### Launch scale (1×: 20k series, 5k calcs/day)

- Observation events/day: 20,000 × 12/365 + churn ≈ **700/day** (first-ingestion burst day one: 20k).
- Bytes, 3-year: observations 2.42M... at 1×: 255k obs/yr × 365 B ≈ 0.27 GB; offers 0.23 GB; summaries 0.64M rows/yr × 220 B ≈ 0.40 GB; calc records: session-bearing 1.5k/day × 1095 d × 750 B ≈ 1.23 GB + anonymous resident 35k × 750 B ≈ 0.08 GB; baskets ≈ 0.18 GB; product master + other ≈ 0.03 GB → **~2.4 GB → 4.2× headroom (PASS)**.
- Rows written/day: ingestion 700 × (4+2+2.5×3) ≈ 12.6k; calc inserts 5k×3 + 0.5k×2 ≈ 16k; retention deletes ≈ 11.4k; ≈ **40k/day vs 1.61M/day equivalent → 40× (PASS)**.
- Reads: ~500k requests/day × ~20 rows-read avg (indexed lookups, FTS5) ≈ 10M/day ≈ 305M/month vs 25B/month → **~82× (PASS)**.

### 10× growth (200k series, 50k calcs/day), 3-year horizon

- Events/day: 200,000 × 12/365 + churn ≈ **6,630/day** → 7.26M observations over 3 years.
- Bytes, 3-year:
  - `priceObservations`: 7.26M × 365 B ≈ **2.65 GB**
  - `retailOffers` appends: 7.26M × 310 B ≈ **2.25 GB**
  - `priceHistorySummaries`: 6,630 × 2.5 × 1095 ≈ 18.1M rows × 220 B ≈ **4.0 GB**
  - `calculationRecords`: session-bearing 15k/day × 1095 × 750 B ≈ **12.3 GB** (never pruned, A8=30%) + anonymous resident 35k×30×750 B ≈ 0.79 GB
  - `basketCalculationRecords`: ≈ **1.83 GB** (same split)
  - `productMaster` + tax/FX/audit/sessions ≈ **0.2 GB**
  - **Total ≈ 24.0 GB vs 10 GB → 0.42× (FAIL)**
- Rows written/day: observations 6,630×4 ≈ 26.5k; offers 13.3k; summaries 49.7k; calc inserts 150k + baskets 10k; retention deletes (row+indexes) ≈ 112k; misc ≈ 1k → **~362k/day ≈ 11.0M/month vs 50M/month → 4.5× (PASS)**.
- Reads: ≈ 10M/day as above scaled ×10 → still **≥8× even at 100M/day**; PASS with the LIKE-fallback caveat below.

### Sensitivity (bytes, 3-year, 10×)

| Change rate (A5) | Session-bearing calcs (A8) | Total bytes | Headroom |
|---|---|---|---|
| 12/SKU/yr | 30% | ~24.0 GB | 0.42× ❌ |
| 4/SKU/yr (realistic) | 5% | ~6.4 GB | 1.56× ❌ |

**Bytes fail the ≥2× bar in every combination at 10× growth.** At the realistic end the failure is driven by un-pruned session-bearing calculation records, not observations.

## Borderline dimensions and what would settle them

1. **`sessionId` coverage of calculations (A8) — the single most decisive unknown.** It swings 3-year calc+basket storage at 10× from ~0.5 GB (0% coverage) to ~16 GB (100%). Current code prunes only `session_id IS NULL` rows, so any client sending `sessionId` grows the DB forever. **Settle it by measuring** the fraction of calculator/basket requests with a `sessionId` in existing staging/dual-run logs (`meta` metrics + request logs), one week of real traffic.
2. **Real price-change frequency (A5).** 12/SKU/yr vs 4/SKU/yr moves the observation-cluster tables (observations + offers + summaries) between ~8.9 GB and ~3.0 GB over 3 years at 10×. **Settle it by counting `ChangedOfferEvent`s per SKU per day from a 2–4 week live Systembolaget feed window** — the hook already emits exactly this event.
3. **Reads (PASS, with a caveat):** the estimate assumes FTS5 answers product search (design D3). If a material share of queries falls through to the `LIKE '%q%'` full scan over `productMaster`, each such scan reads ~200k rows (row-count-based billing, not bytes): at 10× scale, ~1% of 500k searches/day falling through ≈ 1B rows/day — enough to matter. G2's FTS5 quality gate plus logging `meta.rows_read` in staging settles this; it is a G2 concern, not a G1 bytes concern.

## Fix path (for task 1.4 gate review)

The D4 fallback — append-only JSONL for `price_observations` in R2, batch-queried — fits the access pattern exactly (append-only, watermark range scans, `strftime` aggregation can run over exported batches) and removes ~2.7 GB of the 24. **Adopting it alone does not restore 2× headroom.** The gate review should pair it with:

1. **Age-based retention for calculation records regardless of session** (design amendment to D4's retention sentence): e.g. prune session-bearing rows after 12 months. Removes the unbounded term (12.3 GB → ~4.1 GB at 10×). This is a policy change to the existing `CalculationRecordRetentionService` sweep, already scheduled via Cron in D4.
2. **Summary-bucket retention**: keep daily buckets ~90 days, weekly beyond (summaries derive from observations, so they can be rebuilt from R2/DB at any granularity). Cuts the 4.0 GB summaries term roughly in half at 10×.
3. Observations themselves to R2 per D4 (2.65 GB at 10×), with only the relational core (offers, current prices, summaries, calc records) staying in D1.

With all three levers, the realistic-assumption stack lands well under 5 GB (≥2×); the fully conservative stack (12 changes/SKU/yr + 30% session coverage) lands near the line — which is exactly what measurements 1 and 2 above resolve before task 1.4 records the final decision.

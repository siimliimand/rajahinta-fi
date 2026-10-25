# Design: D1 read cost reduction

## Context

Measured attribution (2026-10-19..25, `d1QueriesAdaptiveGroups` on `f8f67277-5046-46fc-9144-4342ab7af003`) pins ~90% of production reads on four code paths: the 30-minute reliability full scan, the two unindexed ingestion lookups, and the data-quality gauges. `product_master` (23,489 rows) has exactly one index (`category`); `retail_offers` (282,253 rows, append-only, no retention) has three indexes, none on `observed_at` alone.

## Decisions

### D1: Three indexes, one migration (0041)

- `product_master(ean)` — the upsert's `FIND_BY_EAN_SQL` (`SELECT id FROM product_master WHERE ean = ? LIMIT 1`) drops from ~5,148 rows-read average to ~1.
- `product_master(name, brand, container_type, unit_volume)` — the name-tuple fallback lookup drops from ~9,746 average to ~1. Four-column equality; column order matches the predicate.
- `retail_offers(observed_at, product_id)` — `SUMMARY_COVERAGE_BOUNDED_SQL` and the freshness reads range-scan the window instead of scanning the table.

Index cost is trivial at these table sizes (23.5k / 282k rows). Drizzle schema mirrors the migration (0037 precedent). D1 suite pins `EXPLAIN QUERY PLAN` (`SEARCH … USING …`, never `SCAN`) for all three consumers — the same regression rail the ageing sweep already has.

Rejected: partial indexes for the lookups (the full indexes also serve `product-search.repository.ts:917` and `:1798`, which read by `ean` outside ingestion).

### D2: Cadence — move the scanners, keep the tick

`merchant-reliability-aggregates` and `data-quality-gauges` move from `AGGREGATION_CRON` (`*/30`) to `TRANSPORT_REFRESH_CRON` (`0 */6 * * *`), registered after the click-counter flush. Everything else on the 30-minute tick stays: the ageing sweep (index-bounded per spec), aggregation, freshness alert, price alerts, savings snapshots, outcome margins — all read materialized summaries or bounded sets already.

The staleness contract changes accordingly: materialized reliability figures may lag up to one refresh interval (6 h) behind the 30-minute ageing pass — between refreshes, VERIFIED counts can overstate. Accepted because the embed is display-only and informational (spec: never affects ranking), the ageing threshold is 7 days, and 6 h ≪ 7 d. The alternative — incremental per-merchant delta maintenance on the write path — couples ingestion to aggregate correctness for a 12× saving the cadence change already delivers.

Registered order preserves the existing invariant within a tick: the refresh still reads the tick's post-ageing statuses whenever a 30-minute ageing pass immediately precedes it.

### D3: Gauges read materialized stores

`data-quality.ts` switches its read sources:

- Feed last-success: `SELECT merchant_id, freshest_observed_at FROM merchant_reliability_aggregates` — 15 rows, replacing the 282k-row `LEFT JOIN … MAX(observed_at)`. The aggregates refresh runs on the same 6-hourly tick immediately before the gauges handler, so figures are same-tick fresh.
- Stale share: `SUM(stale_count) / SUM(offer_count)` from the same table, replacing the `COUNT(DISTINCT …)` recompute.
- The bounded coverage pair keeps its SQL (the parity claim with the backfill script is pinned) — the new `observed_at` index does the work.

Cron handlers run in independent `waitUntil`s with no cross-handler ordering guarantee; the spec documents that gauge figures may lag one tick behind the aggregates refresh. Dashboard-grade tolerance.

### D4: Retention sweep bounds the hot table

New handler `retail-offers-retention` on `RETENTION_CRON` (`30 3 * * *`), alongside the calculation-record sweep and contact retention.

- Deletes only rows that are (a) superseded — not the deterministic-latest row (`observed_at DESC, id DESC`) for their `(merchant, product_id)` pair — and (b) older than the 30-day window.
- Safety chain, in order: the R2 observation log mirrors every append (`retail_offer_id`), `price_history_summaries` materializes the daily aggregates the historical surfaces read (`historical.routes.ts` reads summaries, never raw offers — verified), and 30 days ≫ the 7-day ageing threshold, so nothing a consumer reads is lost. Pre-flight assertion: LANDED_COST provenance citations copy observation fields into their own records rather than FK-referencing `retail_offers`; the sweep refuses to leave dry-run mode until that holds.
- Dry-run first (the `nonalcoholic-catalog-audit` precedent): report-only mode is the default first execution and the staging smoke path; the live mode flips an explicit flag.
- Cursor-chunked bounded batches (contact-retention precedent) — never one unbounded DELETE. D1 has no `DELETE … LIMIT`; batches select superseded ids past the cursor, delete by id list, advance.
- Window is a code constant (30 days), not an env var — nothing operational tunes it today, and the retention contract is a spec matter, not a toggle.

Result: the hot table converges to current rows + a 30-day trailing window (a small multiple of today's 282k instead of unbounded growth), and every remaining scan in the system becomes O(bounded window).

## Cost projection

| path | today | after |
|---|---|---|
| reliability refresh | 449M/wk | ~5M/wk (6-hourly) |
| ingestion lookups | 390M/wk | ~0.1M/wk (indexed) |
| feed-last-success | 86M/wk | ~0 (15-row read) |
| coverage pair | 46M/wk | ~2M/wk (range scan) |
| request-path universe scan | 42M/wk | unchanged (out of scope) |
| everything else | ~85M/wk | unchanged |
| **total** | **~1.15B/wk (165M/day)** | **~40–70M/wk (6–10M/day)** |

Both endpoints sit inside the 25B free inclusion; the change removes the growth curve, not just today's constant.

## Owner gates

1. The staleness-pin change (D2) — accepted in this proposal's review.
2. Production migration apply + first destructive retention pass (task 5.3), after the staging dry-run report is reviewed.

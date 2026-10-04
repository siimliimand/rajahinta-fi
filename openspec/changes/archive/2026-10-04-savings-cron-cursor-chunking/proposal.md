# Proposal: savings-cron-cursor-chunking

## Why

PRODUCTION INCIDENT (2026-10-04, caught live via worker tail during the
07:30 UTC tick): the daily savings-snapshot pass is an O(catalog)
sequential-I/O walk inside a single Worker invocation. The catalog doubled
twice this month (4,414 → 8,700 → 9,494 products) and the walk now exceeds
Cloudflare's per-invocation subrequest budget partway through — the tail
logged a continuous wall of `Savings snapshot failed for product NNNN: Too
many API requests by single Worker invocation` from product ≈4,852 onward.

Three consequences:

1. **Linked rows never materialize.** The 49 CONFIRMED
   alko-reference links (change `alko-reference-matching-pipeline`,
   confirmed 2026-10-04 06:45 UTC) sit at the END of the enumeration
   (linked ids appended after the direct set) — past the subrequest death
   line. Zero linked snapshot rows, ever.
2. **The direct path is silently capped.** Only qualifying products with
   id ≲ 4,852 are ever evaluated; the remaining ~4,600 (daily-cron-grown
   catalog) are lost per day. This predates the linked-qualification
   change: 2026-10-03's 439 rows show the same cap. The isolation design
   (log + count, never fatal) masked the loss as routine failures.
3. **Same scaling disease as the unitprice N+1 incident**
   (`unitprice-ranking-scale-fix`): per-item I/O multiplied by a
   fast-growing catalog in one invocation.

## What Changes

- The savings pass becomes **cursor-chunked across ticks** (the repo's own
  watermark precedent): each 30-min tick reads a persisted product-id
  cursor, processes a bounded CHUNK (300 products) of the combined
  qualifying list sorted by product id ascending, advances the cursor, and
  resets to 0 after consuming the list. The `(asOf, product_id)` upsert
  keeps every chunk idempotent; the day converges across the 48 daily
  ticks (14,400 chunk capacity vs 9,494 catalog — 52 % headroom).
- The cursor rides the existing generic `aggregation_watermarks` table
  (`job_name = 'savings-snapshot-cursor'`) — **no migration**.
- Linked products ride the same sorted list instead of an appended tail —
  they distribute across chunks and materialize within the first ticks
  after confirmation (structural fix for the unreachable-tail bug class).
- Budget regression pin (the test that would have caught this): a
  synthetic 5,000-product walk across multiple simulated invocations
  asserts every invocation's D1 statement count stays under the empirical
  budget.
- Direct-path coverage is RESTORED to the full catalog (the silent cap
  lifts); no route, repository, calculator, or frontend changes.

## Capabilities

No spec delta: `savings-discovery` pins WHAT materializes (the daily
materialized gap listing, idempotent per as-of date, per-product failure
isolation) — all preserved. The chunked cadence is an implementation
property of "runs in a scheduled background job off the request path"; the
spec's idempotency and isolation scenarios are re-proven at chunk grain.

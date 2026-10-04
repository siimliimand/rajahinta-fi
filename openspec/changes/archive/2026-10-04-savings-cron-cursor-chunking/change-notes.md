# Change notes — savings-cron-cursor-chunking

## Production incident — 2026-10-04 timeline (tail evidence)

**06:45 UTC** — 49 alko-reference links transitioned to `CONFIRMED`
(owner-directed, change `alko-reference-matching-pipeline`). From this
moment every linked foreign product was a qualifying product for the
savings pass — and none of them could ever materialize, for structural
reasons discovered 45 minutes later.

**07:30 UTC tick** — the worker tail (caught live) logged a continuous
wall of `Savings snapshot failed for product NNNN: Too many API requests
by single Worker invocation` starting at product ≈4,852 and repeating for
every id after it, with **no completion line** for the pass. Zero linked
snapshot rows materialized: v2 appended the linked ids AFTER the direct
enumeration, so all 49 sat past the per-invocation subrequest death line —
structurally unreachable, on every tick, forever.

**The silent direct-path cap predates v2.** Only qualifying products with
id ≲ 4,852 were ever evaluated, even before links existed — the same
death line at the same catalog shape. The proof is the previous day:
2026-10-03's pass produced 439 rows, the same truncation, unnoticed
because the isolation design (log + count, never fatal) reported the loss
as routine per-product failures. Root cause in both cases: an O(catalog)
sequential-I/O walk inside a single Worker invocation, with the catalog
doubled twice in a month (4,414 → 8,700 → 9,494 products). Per day, the
~4,600 products above the death line were silently lost. Same scaling
disease as the unitprice N+1 incident (`unitprice-ranking-scale-fix`).

## The fix (task 1.1, commit 40b0344)

- **Cursor-chunked walk across ticks**: each */30 tick processes the next
  `SAVINGS_SNAPSHOT_CHUNK_SIZE = 300` ids of the combined qualifying list,
  then advances a persisted cursor; when the list is consumed the cursor
  wraps to 0 and the next tick begins the day's pass anew. Write-then-
  advance ordering (the watermark doctrine): the cursor moves only after
  the chunk's upserts are attempted; per-product isolation absorbs
  individual failures, so a poisoned product cannot stall the walk.
- **Cursor rides the generic `aggregation_watermarks` table** —
  `job_name = 'savings-snapshot-cursor'`, last processed product id as
  TEXT, read/written by two raw prepared statements inside the cron
  module. **No migration**; first run defaults the cursor to 0.
- **One total order**: the combined deduplicated list (direct ∪
  CONFIRMED-linked) sorts by product id ASCENDING — linked products ride
  the same list instead of an appended tail, so a confirmed link is
  structurally reachable at a cursor address proportional to its id and
  materializes within the first chunks. This kills the unreachable-tail
  bug class (v2's appended-tail shape) rather than patching one instance.
- **The `(as_of, product_id)` upsert keeps every chunk idempotent** — a
  re-processed chunk (tick overlap, cursor reset, rollback-replay) rewrites
  the same keyed rows; day-pass convergence semantics unchanged from v2.

### Budget math (measured, pinned)

| Quantity | Value |
|---|---|
| Empirical death line (incident) | ≈4,850 walk steps / invocation |
| Measured max D1 statements per chunk (budget-pin fixture, real calculator path) | **396** |
| Computed per-chunk ceiling (4 fixed + 300 offer reads + ~30 qualifying × ~5) | ≈454 |
| Regression pin (design D4) | **1,000** — 2× headroom over the ceiling |
| v2 single-walk cost on the same 5,000-product fixture | ≈7,500 statements — 7× over the pin |
| Daily capacity | 48 ticks × 300 = **14,400** products/day |
| Catalog | 9,494 products — **52 % headroom** |

The pin has teeth: the fixture's full-day total is asserted greater than
the budget, so deleting the chunking fails the test by construction — it
is the test that would have caught the incident. The recalibration point
is documented (design D2): an all-qualifying chunk costs ≈1,800 > 1,000,
so if the catalog's qualifying share grows materially, CHUNK comes down or
the pass moves to a Queue/DO before capacity does.

## Verification

- `vitest run` (api-worker, Node 24.21.0): **67 test files, 1,145 tests,
  all passing.** The new v3 suites cover: the budget pin (5,020-evaluation
  synthetic catalog across 17 simulated invocations — 16 full chunks + a
  220-id tail — every invocation ≤ 1,000 statements, 520 rows converged,
  cursor wrapped to 0), linked reachability (CONFIRMED-linked ids
  materialize in the FIRST chunk, interleaved in id order — the incident's
  assertion), the exactly-300 chunk window, wrap and fresh-day restart,
  idempotent re-write on cursor reset, cursor persistence across ticks,
  and advance-past-a-failed-product (no eternal stall). The existing v2
  suites run unchanged and green.
- `tsc --noEmit` (api-worker): **clean, exit 0.**

## Post-deploy live checks

All via direct owner-directed D1 (the repo's sanctioned no-token path —
from `apps/api-worker`, where `wrangler.jsonc` lives; no audit_events
entries, same recorded gap as precedent):

```bash
cd apps/api-worker
npx wrangler d1 execute DB --remote --env production --command "SELECT …"
```

Deploy well before a */30 boundary so the checks bracket a full tick; the
per-tick observability line (design D5) is the quick tail signal:
`Savings-snapshot pass chunk [X..Y] of M qualifying (cursor N): R rows
written, S skipped, F failed` — one per tick, and no subrequest failures.

1. **First linked snapshot rows after the next tick** — the 49 CONFIRMED
   links materialize as the id-ordered walk crosses their ids:

   ```sql
   SELECT COUNT(*) FROM savings_snapshots
    WHERE reference_link_id IS NOT NULL AND as_of = date('now');
   ```

   Must be **> 0** after the next tick (linked ids below the current chunk
   window appear immediately — the linked-reachability property; links
   sitting above the first chunk flip positive within the following ticks,
   all 49 within the first day-pass).

2. **The cursor advances tick-over-tick** — run after two consecutive
   ticks and compare:

   ```sql
   SELECT watermark, updated_at FROM aggregation_watermarks
    WHERE job_name = 'savings-snapshot-cursor';
   ```

   The value grows by ~300 per tick (the chunk's last product id) and
   resets to `'0'` on wrap. A stuck value across two ticks is the stall
   signal the D5 line would also show.

3. **Direct-path coverage restored past the old cap (id 4,852)** —
   today's row count grows across ticks until the walk wraps:

   ```sql
   SELECT COUNT(*) FROM savings_snapshots WHERE as_of = date('now');
   SELECT COUNT(*) FROM savings_snapshots
    WHERE as_of = date('now') AND product_id > 4852;
   ```

   The second query is the incident's direct refutation: > 0 as soon as
   the day's walk crosses the old death line — previously never evaluated.
   The daily total converges (idempotent re-writes) to the full qualifying
   count once the walk wraps, materially above the pre-fix 439-row
   baseline of 2026-10-03.

## Terminality / rollback

**No migration exists to undo**: the cursor rides the pre-existing generic
`aggregation_watermarks` table, created by `INSERT … ON CONFLICT` on first
run. **Rollback is a plain `git revert 40b0344` and redeploy** — v2's
single-invocation walk is restored, and the `savings-snapshot-cursor` row
is inert state either way: the reverted code never reads it (harmless to
keep), and deleting it is one guarded statement if a clean slate is
preferred (`DELETE FROM aggregation_watermarks WHERE job_name =
'savings-snapshot-cursor'`; the table's other job rows are untouched).

Rollback honesty: reverting re-opens the incident, not a neutral option —
the subrequest cap returns at the current catalog size (silent truncation
at ≈4,850 products, linked rows unreachable again). Revert is the remedy
for a broken v3, while the budget pressure itself is what v3 exists to
relieve; if v3 misbehaves operationally, the calibration lever is CHUNK
(design D2's documented margin), not the pre-fix walk.

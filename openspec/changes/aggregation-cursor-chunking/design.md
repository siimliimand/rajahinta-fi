# Design: aggregation-cursor-chunking

## Context

Live tail evidence from the deployed production worker (2026-10-05
11:30 UTC): the */30 scheduled invocation carrying the time-series
aggregation ends `outcome: "exceededWallTime"` at exactly the 15-minute
scheduled-event wall cap (`wall: 899,983 ms`) with `cpu: 7,391 ms` —
an order of magnitude inside the CPU budget. The constraint is elapsed
time blocked on D1 write round-trips (and R2 partition reads), not
compute. With no `time-series-aggregation` watermark row, the pass
scans all partitions and aggregates all ~10,264 active products every
tick, is killed mid-writes, and the next tick starts from zero — the
same ~880-product prefix is rewritten forever (measured: exactly one
net-new summarized product across a full trigger cycle). The sibling
savings-snapshot handler on the SAME tick completed by chunking:
`chunk [4666..4965] of 5871 qualifying (cursor 4665): 300 rows written`
— the design this change ports.

## Decisions

### D1: Second cursor row, not a schema change

The backfill cursor is a new `aggregation_watermarks` row
(`job_name = 'time-series-backfill-cursor'`, `watermark` = last
completed product id as TEXT), written through the same repository-parity
raw SQL the savings cursor uses (`savings-snapshots.ts` precedent).
Rejected: a dedicated table or new columns — a migration for a
transient cursor with no modeling gain; the generic keyed table exists
for exactly this, and per-job rows with job-specific semantics are the
documented contract (watermark-isolation-history-backfill D1).

### D2: Chunk = id-ascending product slice, write-then-advance

Each tick: read watermark W and backfill cursor C; enumerate products
with activity (≥ W, or all when W is null) from the already-scanned
records; take the id-ascending slice after C capped at
`AGGREGATION_CHUNK_PRODUCTS = 300`; aggregate + upsert that slice's
buckets; only then persist C = last completed id. When the remaining
slice is smaller than the cap, this is the final chunk: write
W = activity high water and delete C. The watermark advance rule
(after all writes of the unit succeed, never backwards) is inherited
unchanged; the unit of atomicity shrinks from "whole pass" to "one
chunk", which is what makes killed invocations resume monotonically.

### D3: Settled-watermark passes degenerate to the current shape

Once W exists, a normal tick's active set is small (the last half-week
of activity, re-read from the ISO-week Monday per the existing
partition contract) and fits one chunk. The chunker is therefore not a
backfill-only special case — it is the pass loop with a cap, and the
pre-existing single-pass behavior is the degenerate one-chunk case.
No mode flag, no divergent code path to maintain.

### D4: Metric stays global; alert noise during convergence is documented, not suppressed

`emitSummaryCoverage` keeps computing the ratio over ALL products with
observations (both D1 counts are cheap and window-independent), emitted
after each tick's chunk writes. During the ~35-tick initial convergence
the ratio climbs from ~0.09 toward 1 and the
`RajahintaHistorySummaryCoverageBelowInvariant` alert fires — that is
the alert doing its job (the invariant IS unmet); the runbook instructs
silencing it for the convergence window instead of shaping the metric
or the alert around the migration. A ratio that fails to rise tick over
tick after this change is exactly the regression signal the alert
exists for.

### D5: Runbook precedence for the initial backfill

`scripts/backfill-history-summaries.ts --lower/--restore` assume a
persisted watermark to lower and restore — correct for targeted
re-scans after the first convergence, wrong as the initial-backfill
mechanism (there is nothing to lower; the ticks do the work). §7 is
rewritten to lead with "deploy and wait" and repositions the script as
the targeted re-scan and verification tool (`--plan`/`--verify` stay
the read-only checks).

## Risks

- Partition re-read cost per tick: with W null the scan reads all ~21
  daily JSONL objects every tick until first convergence. Measured
  harmless (the 15-minute budget is spent on D1 writes; R2 reads are a
  small fraction), and it disappears once W is written.
- Chunk size 300 is the savings precedent's number, not a measurement
  for this job (aggregation writes ~25 buckets/product vs savings' 1
  row/product). The budget pin (≤1,000 D1 statements/invocation) is the
  real guard; if 300 products ≈ 7,500 statements violates it, the pin
  fails in CI and the constant drops (e.g. 120) — the pin decides, not
  the guess.
- Concurrent safety: only one */30 invocation runs at a time (cron
  serialization), so cursor races are not a live concern; the
  write-then-advance ordering plus idempotent upserts keep a
  surprise-overlap retry-safe regardless.

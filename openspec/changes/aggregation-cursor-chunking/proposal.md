# Proposal: aggregation-cursor-chunking

## Why

The time-series aggregation's per-invocation pass reads the whole R2
observation log and aggregates every active product (~10,264) in ONE
Worker invocation. Production evidence (2026-10-05 11:30 UTC tick, live
`wrangler tail` on the deployed worker): the invocation ends
`outcome: "exceededWallTime"` at the 15-minute scheduled-event wall cap
having used 7.4 s of its 30 s CPU — the wall time is D1 write round-trips
and R2 reads, not compute, so a CPU-limit bump cannot help. The pass has
never completed: `aggregation_watermarks` has no
`time-series-aggregation` row at all, 9,385 of 10,264 products with
observations have zero `price_history_summaries` buckets (historical
charts stuck on empty, no 90-day price context), and because the null
watermark makes every tick rescan everything with no persisted progress,
each cancelled attempt re-aggregates the same ~880-product prefix.
Waiting for ticks provably never converges.

The proven fix pattern is already in this repository: the savings
snapshot pass hit the same wall (change `2026-10-04-savings-cron-cursor-chunking`,
PR #84) and now completes bounded 300-product chunks per tick through a
cursor row in the shared `aggregation_watermarks` table, verified live
the same day (chunk [4666..4965] of 5871, 300 rows written, handler
complete).

## What Changes

- The aggregation pass becomes cursor-chunked: a
  `time-series-backfill-cursor` row (raw TEXT product-id cursor,
  repository-parity raw SQL — no migration, same generic-table pattern
  as the savings cursor) scopes each tick to a bounded, id-ascending
  slice of at most 300 products having activity after the cursor.
- Per-chunk write-then-advance: the cursor moves only after that
  chunk's idempotent per-bucket summary upserts succeed. A killed
  invocation resumes at the last completed chunk — progress across
  ticks is monotonic by construction.
- The final chunk (fewer than 300 remaining) writes the real
  `time-series-aggregation` watermark at the activity high water and
  closes the cursor. Watermark semantics are unchanged: advanced only
  after all of a chunk's writes succeed, never backwards; incremental
  passes with a settled watermark keep the current single-pass shape
  (the chunker degenerates to one chunk when the active set is small).
- The `rajahinta_history_summary_coverage_ratio` gauge stays GLOBAL
  (summarized products / products with observations) so the Grafana
  coverage-below-invariant alert shows the ratio rising tick over tick
  during convergence. The alert fires by design while the initial
  backfill runs; silencing it for the convergence window is a runbook
  note, not an alert change.
- `docs/ingestion-runbook.md` §7 is rewritten: the initial backfill
  procedure is "deploy and let the ticks converge" (~35 ticks ≈ 17 h at
  the */30 cadence); `scripts/backfill-history-summaries.ts`
  `--lower`/`--restore` remain the targeted re-scan path (corrections,
  gap re-runs), `--plan`/`--verify` unchanged as read-only checks.
- A budget regression pin mirrors the savings precedent: a
  multi-invocation walk over a synthetic large catalog asserts every
  invocation stays ≤ 1,000 D1 statements, and a killed-invocation
  simulation asserts the cursor resumes without rewriting completed
  chunks' decisions (upserts stay idempotent regardless).

## Capabilities

- `historical-price-intelligence` — MODIFIED *Materialized aggregates*:
  the materialization pass SHALL make bounded, resumable progress per
  invocation (cursor-scoped product slice, write-then-advance, ≤1,000
  D1 statements per invocation) and SHALL satisfy the coverage
  invariant at pass-sequence completion (every product with
  observations in the processed range has ≥1 summary bucket once the
  cursor wraps). Per-chunk idempotence, incremental-from-watermark
  semantics, and the request-path prohibition are restated unchanged.

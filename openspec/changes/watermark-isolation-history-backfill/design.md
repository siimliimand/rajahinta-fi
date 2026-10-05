# Design: watermark-isolation-history-backfill

## Context

`aggregation_watermarks` is a generic keyed table: one row per job
(`job_name` UNIQUE). Two writers with different watermark semantics share
it — the time-series aggregation (ISO-8601 instants, advanced only after
all summary writes succeed) and, since
`2026-10-04-savings-cron-cursor-chunking`, the savings-snapshot pass (a
product-id cursor stored as TEXT). The accuracy coverage aggregate
introduced earlier (`honest-trust-surfaces` task 3.1) reads the table with
`SELECT MAX(watermark) FROM aggregation_watermarks` under the assumption
every row is an ISO instant. Both writers are individually correct; the
shared read is wrong.

## Decisions

### D1: Job-scoped read, not a separate table

The coverage query selects the `time-series-aggregation` row directly.
Alternative — moving the savings cursor to its own table — was rejected:
it requires a migration (or a second table) for no modeling gain, and the
root defect is a reader assuming table-wide homogeneous semantics, not the
cursor's storage. Job-scoped reads are the table's contract; the one
violating reader is corrected. The COVERAGE_SQL comment is updated to
state the per-job contract so the next watermark-semantics writer does not
repeat it.

### D2: Strict shape check at the display boundary

`AccuracyCoverageBlock` already documents "an absent or unparseable
watermark renders no sync row: only what exists". The implementation used
`Number.isNaN(Date.parse(v))`, which accepts year-only strings
(`Date.parse("9194")` → year 9194) and other loose forms. The check
becomes a strict ISO-8601 instant regex before `Date.parse`. This is
defense in depth — D1 fixes the producer side; D2 keeps one bad row from
reaching visitors as "1.1.9194" again.

### D3: Backfill through the documented manual re-scan

The aggregation's own contract says "manual re-scans can lower the
watermark directly". The backfill script therefore:

1. reads the current watermark and the earliest observed
   `observed_at` missing from summaries,
2. lowers the persisted watermark to that date (ISO-week Monday
   semantics preserved by the job's own read path),
3. lets the aggregation run (manually triggered or on the next tick) —
   per-bucket upserts are idempotent, so already-summarized ranges are
   rewritten identically,
4. restores the watermark to the pre-backfill value,
5. runs the verification query: products with observations but zero
   summary rows in the last 365 days must be 0.

Request-path aggregation was rejected — "Charts never recompute raw
history" is an architecture rule; the gap is filled by the batch job,
never by the endpoint.

### D4: Coverage measured where the gap is produced

The hourly aggregation cron emits the ratio of summarized products to
products with observations (both cheap D1 counts over the same window it
just processed) so the metric reflects each tick's real state and Grafana
can alert on drift without a new scheduled job.

## Risks

- Backfill re-writes up to ~4 months of daily buckets per product —
  bounded by D1 batch limits; the script chunks per product and is
  resumable (idempotent upserts).
- The Grafana alert needs the metric to exist first (task order enforces
  this).

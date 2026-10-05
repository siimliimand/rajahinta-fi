# Proposal: watermark-isolation-history-backfill

## Why

Production incident found in the 2026-10-04 full-site walkthrough: the home
page's trust row renders "Viimeisin päivitys: **1.1.9194**" to every
visitor. This is a regression from yesterday's
`2026-10-04-savings-cron-cursor-chunking`: that change stores its product-id
cursor in the shared `aggregation_watermarks` table
(`watermark = String(productId)`, e.g. `"9194"`), while the accuracy
coverage read computes `MAX(watermark)` across ALL rows assuming ISO-8601
TEXT. Lexicographically `"9194" > "2026-…"`, so one cursor row shadows the
real ingestion watermark forever.

Two further client-visible symptoms of the same aggregation neighborhood:

1. `price_history_summaries` has **coverage gaps**: products 2180, 1000,
   and 3000 have observations (earliest 2026-09-13) but empty historical
   series — the calculator result page's "Hintahistoria" panel is a
   permanent gray loading skeleton for them, and product pages lose the
   90-day price-context figures.
2. The frontend guard meant to hide an unparseable watermark
   ("absent or unparseable renders no sync row") does not fire, because
   `Date.parse("9194")` succeeds (parsed as year 9194) — the guard never
   sees an invalid date.

## What Changes

- The coverage read in `apps/api-worker/src/routes/outcomes.routes.ts`
  pins the watermark to the aggregation job's own row
  (`WHERE job_name = 'time-series-aggregation'`) instead of a table-wide
  `MAX(watermark)`. Savings-cursor rows and any future non-ISO rows can
  no longer shadow it.
- `AccuracyCoverageBlock` gates the sync-date rendering on a strict
  ISO-8601 shape check, not bare `Date.parse` — the documented
  "unparseable renders no sync row" behavior is actually enforced.
- Missing history buckets are backfilled through the documented manual
  re-scan path (lower the aggregation watermark to the earliest
  observation date; the idempotent per-bucket upserts converge; restore
  the watermark). A new `scripts/backfill-history-summaries.ts` wraps the
  procedure with a verification query (products with observations but no
  summaries → 0), and the runbook gains a section.
- A coverage invariant is pinned by test on the node:sqlite D1 harness:
  one aggregation pass over fixture observations ⇒ every active product
  has at least one summary bucket in range.
- The hourly aggregation cron emits a summary-coverage ratio (summarized
  products / products with observations) as a metric; Grafana Cloud
  alerts on it and on a non-ISO accuracy watermark canary.

## Capabilities

- `calculation-outcomes` — MODIFIED *Catalog coverage block on the
  accuracy response*: the watermark value is job-scoped and strictly
  shape-checked end to end.
- `historical-price-intelligence` — MODIFIED *Materialized aggregates*:
  adds the coverage invariant (observations ⇒ summaries) and the
  documented backfill procedure; the request-path prohibition is
  restated unchanged.

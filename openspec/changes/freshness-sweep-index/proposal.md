# Freshness sweep index

## Why

The verified-ageing sweep (`writeBackAgedVerifiedOffers`, run on every 30-min aggregation tick) flips aged VERIFIED offers to STALE with:

```sql
UPDATE retail_offers SET reliability_status = 'STALE'
 WHERE reliability_status = 'VERIFIED' AND observed_at < :cutoff
```

With no index on `(reliability_status, observed_at)` this is a full table scan every tick. Post-materialization production analytics (2026-10-14, task 4.3 of `merchant-reliability-materialized-aggregates`) measured the sweep at **241,346 rows read per execution** — ≈11.6M rows/day, the largest single consumer of the new steady state (~0.68M/h non-tick + tick work). `retail_offers` is append-only history: the scan grows forever, silently re-creating the cost class the materialization change just removed.

## What Changes

- **Migration 0036**: composite index `retail_offers_reliability_status_observed_at_idx ON retail_offers (reliability_status, observed_at)` — equality on the leading column (`'VERIFIED'`), range on the second (`observed_at < cutoff`). Post-index rows_read scales with offers that actually aged since the last tick, not with catalog+history size.
- **Plan-lock test**: `EXPLAIN QUERY PLAN` of the sweep must use `SEARCH … USING` the index — the invariant is asserted, not assumed.
- Same index serves any status-filtered read (`reliability_status = 'STALE'` share gauges); write cost is one more btree on an append-mostly table — accepted.

## Non-goals

- Indexing for the aggregates recompute (deliberate full scan — no filter to serve).
- Housekeeping of aged STALE rows (retention is a separate concern).

# D1 read cost reduction

## Why

Production D1 (`rajahinta-api-production`, 641 MB) read 1.15B rows the week of Oct 19–25 (~165M/day), a ~15× rise over the early-September baseline (10M/day). Per-query attribution from Cloudflare GraphQL (`d1QueriesAdaptiveGroups`, Oct 19–25) attributes ~1.04B of the 1.15B to seven statements, all self-inflicted scheduled or ingestion work:

| rows/wk | execs | statement | code path |
|---|---|---|---|
| 449M | 426 | `ROW_NUMBER() OVER (PARTITION BY merchant, product_id)` full `retail_offers` window scan | `merchant-reliability-aggregates` cron, every 30 min |
| 233M | 23,952 | `SELECT id FROM product_master WHERE name=? AND brand=? AND container_type=? AND unit_volume=?` | ingestion upsert resolution (`d1-upsert.repository.ts`) — no supporting index |
| 157M | 30,490 | `SELECT id FROM product_master WHERE ean=?` | same upsert path — no supporting index |
| 86M | 379 | `merchant_registry LEFT JOIN retail_offers MAX(observed_at)` | `data-quality-gauges` cron feed-last-success, every 30 min |
| 46M | 174 | two `COUNT(DISTINCT product_id)` over `retail_offers`/`price_history_summaries` | summary coverage gauge — no `observed_at` index, full scan |
| 42M | 1,787 | full listing-universe `id,name` scan | catalog keys / ranking candidates (request path — out of scope here) |
| 24M | 381 | per-merchant `DISTINCT product_id` | `savings-snapshots` (cursor-chunked by design — untouched) |

Two structural causes:

1. **`product_master` carries no index except `category`** (23,489 rows), so every per-offer ingestion resolution linear-scans ~5–10k rows. Cost scales with every new merchant (Alko real feed 2026-10-01, four sitemap-crawl merchants 2026-10-08).
2. **The `*/30` cron tick carries several full scans of `retail_offers`** (282,253 rows), and the table is append-only with no retention — every such scan is O(table size) and the table grows hourly, forever. The 2026-10-14 reliability materialization (the prior billing incident's fix) is itself now the single largest consumer at 30-minute cadence.

At current traffic both the current baseline and the post-change projection sit inside the 25B free inclusion ($0 either way on the Nov 20 invoice). This change buys headroom and growth immunity: the Oct 11 burst peak alone would bill ~$10 if repeated today, and the unbounded-table scans would eventually outgrow the free tier on schedule alone.

## What Changes

- **Indexes (migration 0041)**: `product_master(ean)`, `product_master(name, brand, container_type, unit_volume)` for the two unindexed ingestion lookups, and `retail_offers(observed_at, product_id)` so the bounded coverage query range-scans one window instead of the full table. ~390M+46M rows/wk drop to negligible.
- **Cadence**: the two full-scan handlers (`merchant-reliability-aggregates`, `data-quality-gauges`) move off the 30-minute tick onto the 6-hourly `0 */6 * * *` trigger (449M rows/wk becomes ~5M/wk; 86M+46M shrink via the index and materialized reads). The VERIFIED→STALE ageing sweep stays on the 30-minute tick — it is index-bounded by spec and cheap.
- **Gauges read materialized stores**: the data-quality feed-last-success gauge reads `merchant_reliability_aggregates.freshest_observed_at` (a 15-row read) instead of joining all 282k offers; the stale-share derivation reads `stale_count`/`offer_count` from the same table. The coverage pair keeps its SQL but rides the new `observed_at` index.
- **Bounded hot table (retention sweep)**: a dry-run-first, cursor-chunked daily sweep deletes superseded `retail_offers` rows (not the deterministic-latest row for their merchant×product pair) older than a 30-day window. Observation history is already mirrored in the R2 observation log and `price_history_summaries`; 30 days comfortably covers the 7-day staleness ageing window. This is the only lever that changes the growth curve: scans stop being O(unbounded table).
- **Spec deltas**: `merchant-reliability-scoring` (MODIFIED: refresh cadence and staleness bound), `deployment-observability` (MODIFIED: gauge read sources and documented one-tick lag), `data-acquisition` (ADDED: retention contract).

Projected result: ~5–10M rows/day — back to the September baseline, ~1% of the free inclusion, and no longer growing with table size or merchant count.

## Non-goals

- Request-path caching or materialization of the listing-universe scan (42M/wk — the remaining top consumer; separate change if request traffic grows).
- Batched ingestion resolution (`IN (...)` chunked lookups) — redundant once the indexes land.
- Any change to `savings-snapshots`, ranking, price semantics, or calculator inputs.
- Pruning `price_history_summaries` or the R2 observation log — history stays complete outside the hot table.

## Dependencies

- Migration applies run staging-first; the production apply and the first destructive retention pass are owner-gated (task 5.3).
- Staging cron triggers are disabled (2026-10-14 override), so cadence verification is unit-level plus manual scheduled-event invocation.
- The `merchant-reliability-scoring` staleness pin ("bounded by one tick") changes by explicit owner decision within this proposal: display-only VERIFIED counts may overstate by up to 6 hours (ageing threshold is 7 days; the embed is informational and never feeds ranking).

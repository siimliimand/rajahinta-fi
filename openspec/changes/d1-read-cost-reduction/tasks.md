# Tasks

## 1. Indexes (migration 0041)

- [x] 1.1 Migration `0041_product_read_indexes.sql`: `CREATE INDEX product_master_ean_idx ON product_master(ean)`; `CREATE INDEX product_master_name_brand_container_volume_idx ON product_master(name, brand, container_type, unit_volume)`; `CREATE INDEX retail_offers_observed_at_product_idx ON retail_offers(observed_at, product_id)`; Drizzle schema mirror; D1 suite `EXPLAIN QUERY PLAN` pins proving the ean lookup (`d1-upsert.repository.ts`), the name-tuple lookup, and the bounded coverage query all `SEARCH` the new indexes (never `SCAN`); apply to staging D1 <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/migrations/0041_product_read_indexes.sql, packages/data-platform/src/d1/schema.ts, packages/data-platform/src/d1/__tests__/] -->

## 2. Spec deltas and cron rewiring

- [x] 2.1 Spec deltas: `merchant-reliability-scoring` MODIFIED (six-hourly refresh, staleness bounded by refresh interval — complete post-state scenario set), `deployment-observability` MODIFIED (materialized gauge read sources + one-tick concurrent lag), `data-acquisition` ADDED (bounded retention contract, dry-run-first); `openspec validate --strict` passes <!-- agent: platform-engineer.build, depends_on: [], touches: [openspec/changes/d1-read-cost-reduction/specs/**] -->
- [ ] 2.2 Data-quality gauges read materialized stores: feed last-success from `merchant_reliability_aggregates.freshest_observed_at` (replaces the `LEFT JOIN retail_offers MAX(observed_at)` scan); stale share from `SUM(stale_count)/SUM(offer_count)`; bounded coverage query unchanged in shape (new index makes it a range scan); document the one-tick concurrent-handler lag; data-quality tests updated <!-- agent: platform-engineer.build, depends_on: [1.1, 2.1], touches: [apps/api-worker/src/observability/data-quality.ts, apps/api-worker/src/observability/__tests__/] -->
- [ ] 2.3 Cron rewiring: move `merchant-reliability-aggregates` + `data-quality-gauges` handlers from `AGGREGATION_CRON` (`*/30`) to `TRANSPORT_REFRESH_CRON` (`0 */6 * * *`, registered after click-counter-flush so gauges read same-tick materialized rows); ageing sweep stays on `*/30`; router dispatch tests updated; `wrangler.jsonc` cron comment block updated <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [apps/api-worker/src/cron/router.ts, apps/api-worker/src/cron/__tests__/, apps/api-worker/wrangler.jsonc] -->

## 3. Retention sweep (bound the hot table)

- [x] 3.1 `retail-offers-retention` cron handler: DRY-RUN-FIRST (report-only default, live mode by explicit flag); deletes only superseded rows (not the deterministic-latest row per merchant×product pair) older than the 30-day window; pre-flight assertion that LANDED_COST provenance citations copy observation fields rather than FK-reference `retail_offers` (refuses live mode otherwise); cursor-chunked bounded batch DELETEs by id list (no unbounded DELETE); D1 tests: current rows survive, in-window rows survive, batch bounds hold, re-run is idempotent, history contract intact (R2 log + summaries) <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/cron/retail-offers-retention.ts, apps/api-worker/src/cron/__tests__/retail-offers-retention.test.ts] -->
- [ ] 3.2 Register the handler on `RETENTION_CRON` (`30 3 * * *`, alongside retention-sweep + contact-retention); 30-day window as a code constant; router tests updated <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/api-worker/src/cron/router.ts, apps/api-worker/src/cron/__tests__/] -->

## 4. Docs

- [ ] 4.1 ARCHITECTURE.md module notes (index inventory, six-hourly refresh contract, staleness tolerance, retention window, materialized gauge reads); wrangler.jsonc cron documentation matches the new routing <!-- agent: platform-engineer.fast, depends_on: [2.3, 3.2], touches: [ARCHITECTURE.md, apps/api-worker/wrangler.jsonc] -->

## 5. Verification

- [ ] 5.1 Run typecheck, eslint, unit suites, and the D1 suite; fix fallout <!-- agent: platform-engineer.fast, depends_on: [2.3, 3.2], touches: [] -->
- [ ] 5.2 Staging deploy + smoke: staging crons are disabled (2026-10-14 override), so verify via manual scheduled-event invocation of the moved handlers and the retention DRY-RUN against staging D1 (candidate report reviewed, zero deletions); confirm EXPLAIN pins against staging data; record the dry-run report for the owner gate <!-- agent: devops-engineer.fast, depends_on: [5.1], touches: [] -->
- [ ] 5.3 Production rollout (OWNER-GATED): apply migration 0041 to prod D1; deploy worker; retention dry-run report review, then live mode flip by owner decision; 48 h GraphQL `rowsRead/day` observation vs the 165M/day baseline (expect < 15M/day); review the Billing budget-alert threshold <!-- agent: devops-engineer.fast, depends_on: [5.2], touches: [] -->

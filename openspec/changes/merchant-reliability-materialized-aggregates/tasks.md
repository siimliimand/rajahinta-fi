# Tasks

## 1. Schema

- [x] 1.1 Migration `0035_merchant_reliability_aggregates.sql`: create `merchant_reliability_aggregates` (merchant TEXT PK, offer_count INTEGER NOT NULL, verified_count / estimated_count / stale_count / unavailable_count INTEGER NOT NULL, freshest_observed_at TEXT NOT NULL, computed_at TEXT NOT NULL) and seed it with an `INSERT … SELECT` of the current live aggregate (the same deterministic-latest window query the repositories run today — one-off ~818k-row read at deploy) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/migrations/0035_merchant_reliability_aggregates.sql] -->
- [x] 1.2 Add the table to the Drizzle schema (types + column shapes matching the migration) <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/d1/schema.ts] -->

## 2. Cron materialization

- [ ] 2.1 `handleMerchantReliabilityAggregates` in `apps/api-worker/src/cron/merchant-reliability-aggregates.ts`: recompute the live aggregate (the unbounded window query — 48×/day is ~39M rows, ~$0.04/day) and full-refresh the table (delete + batched insert) in one transaction; register on `AGGREGATION_CRON` in `router.ts` AFTER `freshness-alert` so the tick's VERIFIED→STALE ageing write-back is reflected same-tick; log rows materialized and tick duration <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [apps/api-worker/src/cron/merchant-reliability-aggregates.ts, apps/api-worker/src/cron/router.ts] -->
- [ ] 2.2 Handler tests: materialized rows byte-equal the live aggregate on seeded offers (the incident's core invariant); idempotent re-run converges (no duplicates, stale merchants dropped when their offers disappear); empty catalog leaves the table empty honestly <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/api-worker/src/cron/__tests__/merchant-reliability-aggregates.test.ts] -->

## 3. Read-path switch

- [ ] 3.1 Switch `D1MerchantReliabilityRepository.findCurrentOfferAggregates` to read `merchant_reliability_aggregates` (optional merchant `IN` filter, deterministic merchant-ascending order, no fallback to scanning `retail_offers`); remove the ranked-CTE SQL constants and `D1_BOUND_PARAMETER_CAP`; update the abstract-class contract docs (materialized, ≤ one tick stale, cold start = empty) <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-platform/src/repositories/d1/merchant-reliability.repository.ts] -->
- [ ] 3.2 Repository tests: materialized read returns the seeded figures unchanged; merchant-set filter returns exactly the requested merchants in order; empty table degrades to an empty result (no `retail_offers` scan) <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/data-platform/src/repositories/d1/__tests__/merchant-reliability.repository.test.ts] -->

## 4. Verification

- [ ] 4.1 Worker embed regression: `getMerchantReliabilityMap` tests stay green unchanged (signature and fail-open contract intact); run typecheck + eslint across touched packages <!-- agent: platform-engineer.fast, depends_on: [3.2], touches: [] -->
- [ ] 4.2 Deploy staging + production via the gated workflow (migrate → deploy); confirm the migration seed populated the table and the first tick refreshes it <!-- agent: devops-engineer.build, depends_on: [2.2, 3.2, 4.1], touches: [] -->
- [ ] 4.3 Post-deploy analytics: `d1QueriesAdaptiveGroups` shows the `WITH ranked AS (…)` statement gone from the per-request path; account reads drop to cron-only (~39M/day); `RajahintaD1RowsReadDailyBudget` drains below 1B/24h and stays quiet; spot-check a product page embed renders the badge from materialized rows <!-- agent: devops-engineer.fast, depends_on: [4.2], touches: [] -->

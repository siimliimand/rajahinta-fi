# Tasks

## 1. Schema + proof

- [x] 1.1 Migration `0036_retail_offers_status_observed_idx.sql`: `CREATE INDEX retail_offers_reliability_status_observed_at_idx ON retail_offers (reliability_status, observed_at)` — plain SQL per current migration conventions (no journal edit); header comment states the sweep-cost rationale and the incident linkage <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/d1/migrations/0036_retail_offers_status_observed_idx.sql] -->
- [x] 1.2 Plan-lock test: run migrations in the D1 harness, `EXPLAIN QUERY PLAN` the exact sweep statement, assert `SEARCH … USING INDEX retail_offers_reliability_status_observed_at_idx` (and `SCAN` absent); place per repo test conventions, runs in CI (FTS5-blocked locally) <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/cron/__tests__/freshness-ageing.test.ts] -->

## 2. Verification

- [ ] 2.1 Deploy staging + production via the gated workflow (migrate → deploy); confirm index exists in both environments; post-deploy analytics: sweep execution rows_read drops from ~241k/tick to matched-rows scale; account steady-state unchanged or lower <!-- agent: devops-engineer.build, depends_on: [1.2], touches: [] -->

# Tasks — Phase 1 Launch Readiness

## 1. Age-gate token propagation

- [x] 1.1 Send age-confirmation token from the web app: store one shared token on confirm (cookie `age_confirmed`), inject `x-age-confirmed` header into the shared `request()` helper in `api.ts`. <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/lib/api.ts, apps/frontend/src/app/components/AgeGate.tsx] -->
- [x] 1.2 Test that a confirmed session sends the header and uses one shared storage key. <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/lib/api.ts, apps/frontend/src/app/components/AgeGate.tsx] -->

## 2. Result endpoint gating

- [x] 2.1 Apply `LaunchGateGuard` + `AgeGateGuard` + `@LaunchGate(CALCULATION)` to `CalculatorController` at class level so `getResult` is gated. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/calculator/calculator.controller.ts] -->
- [x] 2.2 Regression test: `GET result/:recordId` returns 403 with gates off / missing age token. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/application-api/src/calculator/**] -->

## 3. Launch-gate semantics

- [x] 3.1 Require all three gates for `PRICE_DATA` (align `isPriceDataVisible` with the §9 launch condition). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/feature-flags/launch-gate.service.ts] -->
- [x] 3.2 Update launch-gate tests to all-three semantics for price data. <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/application-api/src/__tests__/launch-gate.service.test.ts, packages/application-api/src/__tests__/launch-gate-regression.test.ts] -->

## 4. Cache invalidation loop

- [x] 4.1 Pass active dataset versions into `idempotency.lookup()` from `CalculatorController` so stale versions are treated as a miss. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/calculator/calculator.controller.ts, packages/application-api/src/idempotency/idempotency.service.ts] -->
- [x] 4.2 Wire `invalidateOnVersionChange()` into the new-dataset-version detection path (rate-review/pipeline). <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/application-api/src/jobs/**, packages/data-acquisition/src/services/rate-review-scheduler.service.ts] -->
- [x] 4.3 Test cache HIT for v1, then dataset flips to v2 → MISS. <!-- agent: platform-engineer.build, depends_on: [4.2], touches: [packages/application-api/src/__tests__/idempotency.service.test.ts] -->

## 5. Correction back-linkage

- [x] 5.1 Add an affected-records query port and Drizzle implementation (records referencing a flagged product/offer/transport/tax). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/correction/correction-repository.port.ts, packages/data-platform/src/repositories/calculation-record.repository.ts] -->
- [x] 5.2 Populate `linksToCalculationRecords` for ACCEPTED data-point flags in `buildResolutionAction`. <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/core-domain/src/correction/correction.service.ts] -->
- [x] 5.3 Tests: data-point resolve links the affected calculation records. <!-- agent: platform-engineer.build, depends_on: [5.2], touches: [packages/core-domain/src/correction/__tests__/correction.service.test.ts] -->

## 6. Rate-review source

- [x] 6.1 Introduce `RateChangeSourcePort` with a config-backed source; replace the unconditional no-op with a port call (never-auto-publish preserved). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/services/rate-review-scheduler.service.ts, packages/data-acquisition/src/interfaces/rate-review-repository.port.ts] -->
- [x] 6.2 Update rate-review tests for the source-port path (incl. `createRateUpdateTask` no-auto-publish). <!-- agent: platform-engineer.build, depends_on: [6.1], touches: [packages/data-acquisition/src/__tests__/rate-review-scheduler.service.test.ts] -->

## 7. Staging schema fidelity

- [x] 7.1 Align `infra/staging-data/schema.sql` with the Drizzle schema (nullable tri-state `deposit_system_status`; reconcile other column drift). <!-- agent: platform-engineer.build, depends_on: [], touches: [infra/staging-data/schema.sql] -->

## 8. Data-quality script

- [x] 8.1 Make `test-data-quality.sh` degrade to the vitest suite when psql/Postgres is absent; replace the always-pass null check with a real assertion. <!-- agent: devops-engineer.fast, depends_on: [], touches: [scripts/test-data-quality.sh] -->

## 9. E2E wiring + guard coverage

- [x] 9.1 Rewrite the backend e2e test to drive the HTTP layer (supertest) with age token + open gates; assert 403 without token / gates off and 200 with them. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/backend/tests/e2e/calculator.test.ts] -->
- [x] 9.2 Point the root e2e vitest config at `apps/backend/tests/e2e` (or add a script) so `pnpm test:e2e` runs >0 tests. <!-- agent: devops-engineer.fast, depends_on: [9.1], touches: [vitest.config.e2e.ts, package.json] -->

## 10. Search sort wiring

- [x] 10.1 Apply the requested sort via `RankingService` or reject unsupported sort with an explicit 4xx (no silent alphabetical). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/search/search.controller.ts, packages/application-api/src/search/search.dto.ts] -->
- [x] 10.2 Tests for sort behavior. <!-- agent: platform-engineer.build, depends_on: [10.1], touches: [packages/application-api/src/search/**] -->

## 11. Ranking lockstep

- [x] 11.1 Add an automated drift test comparing the frontend ranking copy against `RankingService.describeSortOrder()`. <!-- agent: platform-engineer.build, depends_on: [], touches: [tests/compliance/**, apps/frontend/src/app/ranking/page.tsx] -->

## 12. Docs resync

- [x] 12.1 Resync `docs/tasks.md` checkboxes to the verified code state (flip done items; annotate partials). <!-- agent: platform-engineer.build, depends_on: [2.1,3.1,4.2,5.2,6.1,9.1,10.1], touches: [docs/tasks.md] -->
- [x] 12.2 Correct `ARCHITECTURE.md` inaccuracies (snake_case tables, K8s manifests, Redis idempotency, load scope, staging schema). <!-- agent: platform-engineer.fast, depends_on: [12.1], touches: [ARCHITECTURE.md] -->

## 13. Verification

- [x] 13.1 Run full verification: typecheck, unit, lint, golden, data-quality, compliance, e2e, load. <!-- agent: devops-engineer.fast, depends_on: [1.2,2.2,3.2,4.3,5.3,6.2,7.1,8.1,9.2,10.2,11.1,12.2], touches: [] -->

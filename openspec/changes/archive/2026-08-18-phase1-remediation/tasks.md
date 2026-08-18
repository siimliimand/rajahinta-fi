# Tasks — Phase 1 Remediation

## 1. Launch Gate Enforcement

- [x] 1.1 Apply `@UseGuards(LaunchGateGuard)` + `@LaunchGate(CALCULATION)` to `CalculatorController.calculate`; ensure the guard is registered and resolvable. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/calculator/calculator.controller.ts] -->
- [x] 1.2 Apply `@UseGuards(LaunchGateGuard)` + `@LaunchGate(PRICE_DATA)` to `SearchController` product/price endpoints. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/search/search.controller.ts] -->
- [x] 1.3 Add regression test asserting both controllers are launch-gated and the guard denies access when the flag is off. <!-- agent: platform-engineer.build, depends_on: [1.1,1.2], touches: [packages/application-api/src/__tests__/**] -->

## 2. Correction Mechanism API Surface

- [x] 2.1 Add `CorrectionController` + DTOs: `POST /api/v1/corrections` (flag), `GET /api/v1/corrections` (list), `POST /api/v1/corrections/:id/resolve`. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/correction/**] -->
- [x] 2.2 Wire `CorrectionService` + `ICorrectionRepository` (in-memory for dev, Drizzle adapter for prod) at the composition root. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/application-api/src/index.ts, apps/backend/src/app.module.ts, packages/data-platform/src/**] -->
- [x] 2.3 Tests for correction endpoints + repository adapter (flag → tracked review item → resolve → link to historical calculation records). <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [packages/application-api/src/correction/**] -->

## 3. Age Gate Enforcement

- [x] 3.1 Add `AgeGateGuard` reading a confirmation token (cookie/header) and delegating to `AgeGateService`. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/age-gate/**] -->
- [x] 3.2 Apply the guard to alcohol-content endpoints (calculation + price data); leave landing and comparison pages public. <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/application-api/src/calculator/calculator.controller.ts, packages/application-api/src/search/search.controller.ts] -->
- [x] 3.3 Tests: confirmation semantics (simple confirmation, not identity verification) and public-route exemption. <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [packages/application-api/src/age-gate/**] -->

## 4. Rate Review Automation

- [x] 4.1 Wire `RateReviewSchedulerService` into `JobsSchedulerService` so a recurring job actually runs the review. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/jobs/**] -->
- [x] 4.2 Replace the mock `checkForRateChanges` with a real source check or an explicitly documented decision; test the `createRateUpdateTask` never-auto-publish path. <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/data-acquisition/src/services/rate-review-scheduler.service.ts] -->

## 5. Redis-backed Cache

- [x] 5.1 Implement a Redis-backed idempotency/cache store keyed by input hash + tax/transport dataset versions. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/idempotency/**] -->
- [x] 5.2 Wire the Redis client provider + config (reuse existing Redis infrastructure). <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/application-api/src/idempotency/**] -->
- [x] 5.3 Tests: hit/miss behavior and invalidation on dataset-version change. <!-- agent: platform-engineer.build, depends_on: [5.2], touches: [packages/application-api/src/idempotency/**] -->

## 6. Billing Deferral

- [x] 6.1 Record the explicit Phase 2 deferral of third-party billing; keep `BillingService` interface stable; correct `docs/tasks.md` task 14.1. <!-- agent: platform-engineer.fast, depends_on: [], touches: [packages/application-api/src/billing/billing.service.ts, docs/tasks.md] -->

## 7. Account API Surface

- [x] 7.1 Expose saved-baskets endpoints (list/save/delete). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/**] -->
- [x] 7.2 Expose the calculation-history endpoint. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/**] -->
- [x] 7.3 Expose the subscription-status endpoint (delegates to `BillingService`). <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/**] -->
- [x] 7.4 Tests for account endpoints. <!-- agent: platform-engineer.build, depends_on: [7.1,7.2,7.3], touches: [packages/application-api/src/accounts/**] -->

## 8. Load Test Scope

- [x] 8.1 Point the load test at the HTTP calculation endpoint, or document its orchestrator-only scope in the test header. <!-- agent: devops-engineer.build, depends_on: [], touches: [tests/load/**] -->

## 9. Docs Resync

- [x] 9.1 Resync `docs/tasks.md` and `ARCHITECTURE.md` checkboxes/status tables to the true implementation state. <!-- agent: platform-engineer.fast, depends_on: [], touches: [docs/tasks.md, docs/ARCHITECTURE.md] -->

## 10. Validation Exception Types

- [x] 10.1 Replace `InternalServerErrorException` with `BadRequestException` / `UnprocessableEntityException` in `CalculatorController` validation. <!-- agent: platform-engineer.fast, depends_on: [], touches: [packages/application-api/src/calculator/calculator.controller.ts] -->
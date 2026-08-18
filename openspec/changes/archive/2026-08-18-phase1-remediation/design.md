# Design — Phase 1 Remediation

## Context

The Phase 1 MVP is functionally complete at the domain layer but has ten gaps, all concentrated in the application/API boundary and the docs. This design describes how each gap is closed without disturbing the working core-domain engines.

## Decisions

### 1. Launch gate wiring

`LaunchGateGuard` and the `@LaunchGate` decorator already exist in `packages/application-api/src/feature-flags/`. The fix is application, not new logic:

- `CalculatorController.calculate` gets `@UseGuards(LaunchGateGuard)` + `@LaunchGate(LaunchGateType.CALCULATION)`.
- `SearchController` gets `@UseGuards(LaunchGateGuard)` + `@LaunchGate(LaunchGateType.PRICE_DATA)`.
- `LaunchGateGuard` stays registered in `FeatureFlagsModule`; no global guard, so landing pages and non-alcohol endpoints remain reachable.

`LaunchGateService` reads the three gates from env (`LAUNCH_GATES_OVERRIDE` forces all open in tests). No change to the service.

### 2. Correction API

`CorrectionService` (core-domain) is complete and tested. Add a thin `CorrectionController` under `packages/application-api/src/correction/` with three routes: flag, list, resolve. A Drizzle-backed `ICorrectionRepository` adapter joins the existing in-memory adapter, wired at the composition root in `apps/backend/src/app.module.ts` and `packages/data-platform`.

### 3. Age gate enforcement

Add `AgeGateGuard` in `packages/application-api/src/age-gate/` that reads a signed confirmation token (cookie or `X-Age-Confirmed` header) and delegates to `AgeGateService`. Apply it to calculation and price-data endpoints. The semantics stay a simple confirmation, not identity verification; public comparison and landing pages are not gated.

### 4. Rate review automation

`RateReviewSchedulerService.checkForRateChanges()` currently hardcodes `newRatesDetected=false`. Wire the service into `JobsSchedulerService` so a recurring job runs it, and replace the mock body with either a real Finnish Tax Administration source fetch or an explicit, documented decision to keep discovery disabled outside production. `createRateUpdateTask()` already enforces the never-auto-publish rule; a test must exercise it.

### 5. Redis-backed cache

`IdempotencyService` uses `InMemoryIdempotencyCache`. Add a Redis-backed store implementing the same interface, keyed by the input hash plus tax/transport dataset versions, with invalidation on dataset-version change. The Redis client is already provisioned in `docker-compose.yml`; the in-memory store remains the test/dev fallback.

### 6. Billing deferral

Third-party billing is out of MVP scope per the implementation plan ("no premium tiers required yet"). Keep `BillingService` as a stable mock interface and record the Phase 2 deferral in `docs/tasks.md` and the service header. No provider integration in this change.

### 7. Account endpoints

`AccountService` already models saved baskets, calculation history, and subscription status; only `GET /export` is exposed. Add the missing routes to `AccountController`: baskets (list/save/delete), history, and subscription status (delegating to `BillingService`).

### 8. Load test

`tests/load/calculator-load.test.ts` measures the orchestrator with mocked I/O. Either point it at the HTTP endpoint against a booted app or rename and document its orchestrator-only scope. The devops engineer decides based on CI feasibility.

### 9. Docs resync

Rewrite the checkboxes and status tables in `docs/tasks.md` and `ARCHITECTURE.md` to match reality: frontend, K8s manifests, vocabulary lint, correction domain, billing stub, age-gate service, and accounts all exist; the launch gate, correction API, rate-review automation, and Redis cache were not complete until this change.

### 10. Validation exceptions

`CalculatorController.validateCalculateRequest` throws `InternalServerErrorException` with a `statusCode` override. Replace with `BadRequestException` for 400 and `UnprocessableEntityException` for the classification-gate rejection (422).

## Non-goals

- No change to tax math, classification rules, ranking neutrality, or deposit-checker semantics.
- No third-party billing integration.
- No identity verification; the age gate remains a simple confirmation.
- No legal-opinion work (external, unchanged).

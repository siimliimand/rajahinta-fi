# Phase 2C — Advanced Features — Tasks

> Derived from Task 2C (T2.10 through T2.13) of `docs/tasks.md`.
> All tasks assigned to `platform-engineer` (TypeScript, NestJS, Drizzle, React scope). No `devops-engineer` tasks: no infrastructure or CI/CD changes.

---

## 1. Data model

- [x] 1.1 Add `savedScenarios` table to `packages/data-platform/src/schema.ts` — id, accountId FK → accounts (cascade delete), name, inputs JSONB (productId, quantity, destination, transportMethod?, transportArrangement?), createdAt, updatedAt; unique (accountId, name); Drizzle migration <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**] -->
- [x] 1.2 Create `SavedScenarioRepository` at `packages/data-platform/src/repositories/saved-scenario.repository.ts` — findByUserId, upsert by (accountId, name), delete by id; register in `DataPlatformModule` <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/repositories/saved-scenario.repository.ts, packages/data-platform/src/data-platform.module.ts] -->
- [x] 1.3 Create merchant reliability aggregate repository at `packages/data-platform/src/repositories/merchant-reliability.repository.ts` — SQL grouping of `reliability_status` counts by merchant over current retail offers plus freshest observedAt and offer count; register in `DataPlatformModule` <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/merchant-reliability.repository.ts, packages/data-platform/src/data-platform.module.ts] -->

## 2. Core domain

- [x] 2.1 Create `MerchantReliabilityScoreService` at `packages/core-domain/src/reliability/` — pure function from per-merchant offer-status counts + governance permission status to a factual score object (offerCount, per-status counts and shares, strictest status via `composeReliability`, freshest observedAt, governance status, computedAt); no letter grades, no weights, no subjective labels <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/reliability/**] -->
- [x] 2.2 Extend `ExciseDeclarationService` and `DeclarationSummary` at `packages/core-domain/src/declaration/` with a `guidance` object — derivation (category, ABV, volume × quantity, applied rates with rule version labels and formula reference, from the persisted record), computed advance-notice deadline from the calculation timestamp, ordered MyTax entry checklist (observed-pattern phrasing), confidence caveats (LOW confidence, unknown deposit status, fallback dataset version), official vero.fi source links; type-level read-only proofs and `NO_SUBMISSION_GUARANTEE` unchanged <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/declaration/**] -->

## 3. API layer

- [x] 3.1 Add scenario support to `AccountService` (optional `SavedScenarioRepository` injection with the existing non-test fail-fast) and endpoints on `AccountController` — `GET /api/v1/account/scenarios` (list with inputs), `POST /api/v1/account/scenarios` (upsert by name), `DELETE /api/v1/account/scenarios/:id`; `x-user-id` header pattern; gated by the `ADVANCED_FEATURES` flag <!-- agent: platform-engineer.build, depends_on: [1.2, 5.1], touches: [packages/application-api/src/accounts/**] -->
- [x] 3.2 Integrate scenarios into the account data lifecycle — `DataExportService.exportUserData` includes saved scenarios; `anonymizeAccount`/erasure cascades to scenarios (delete by accountId); audit events recorded; retention covered by the account inactivity path <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/application-api/src/accounts/**] -->
- [x] 3.3 Create the reports module at `packages/application-api/src/reports/` — `ReportExportService` reading the record via the existing `ICalculationRecordQueryPort` (never recomputing): lossless JSON, RFC-4180-escaped flat CSV with a structural disclaimer row, printable HTML for browser print-to-PDF (no new dependency); `GET /api/v1/reports/:recordId?format=json|csv|html` with content-type/disposition per format; `EntitlementGuard` + `@RequireFeature('calculation:export')`, `RateLimitGuard`, `AgeGateGuard`, and flag gating; every line carries reliability, dataset version, and timestamp <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/application-api/src/reports/**] -->
- [x] 3.4 Create `MerchantReliabilityController` + module at `packages/application-api/src/merchants/` — `GET /api/v1/merchants/reliability` returning scores for all merchants; embed the per-merchant score where offers are surfaced (product detail responses served by the search module); guard with `LaunchGateGuard`, `AgeGateGuard`, and the flag <!-- agent: platform-engineer.build, depends_on: [1.3, 2.1, 5.1], touches: [packages/application-api/src/merchants/**, packages/application-api/src/search/**] -->
- [x] 3.5 Extend the declaration DTO and `DeclarationController` response with the `guidance` object — additive field, existing consumers unaffected <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [packages/application-api/src/declaration/**] -->

## 4. Frontend

- [x] 4.1 Add scenario controls — "Save scenario" (name input + save) and a scenario picker on the calculator page; loading a scenario repopulates product/quantity/destination and re-runs the calculation; scenario list section on the account page; hidden when the flag is off; types + fetch client under `apps/frontend/src/lib/` <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/calculator/**, apps/frontend/src/app/account/**, apps/frontend/src/lib/**] -->
- [x] 4.2 Add export affordances — JSON/CSV download and print-report actions on the calculator result view and account history entries; controlled-vocabulary labels; hidden when the flag is off <!-- agent: platform-engineer.build, depends_on: [3.3], touches: [apps/frontend/src/app/calculator/**, apps/frontend/src/app/account/**, apps/frontend/src/lib/**] -->
- [x] 4.3 Add the merchant data-freshness display to compare product columns — factual counts/shares/freshest timestamp from the reliability endpoint, controlled vocabulary, neutral equal-treatment styling, no ranking alteration; hidden when the flag is off <!-- agent: platform-engineer.build, depends_on: [3.4], touches: [apps/frontend/src/app/compare/**, apps/frontend/src/lib/**] -->
- [x] 4.4 Add the declaration guidance panel to the calculator result detail page — collapsible panel fed by `/api/v1/declaration/:recordId`, rendering derivation, deadline, checklist, and caveats with observed-pattern phrasing; hidden when the flag is off <!-- agent: platform-engineer.build, depends_on: [3.5], touches: [apps/frontend/src/app/calculator/**, apps/frontend/src/lib/**] -->

## 5. Feature flag

- [x] 5.1 Add `ADVANCED_FEATURES` to the `FeatureFlag` enum at `packages/application-api/src/feature-flags/feature-flag.types.ts` (slug `enable_advanced_features`, env `FF_ADVANCED_FEATURES`) — default OFF; gates scenario, report, reliability, and guidance surfaces <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/feature-flags/**] -->

## 6. Tests and verification

- [x] 6.1 Write core-domain unit tests — score service (pure aggregation across all status mixes, strictest-status composition, unknown-status rejection), declaration guidance (derivation fields, deadline computation, caveats on LOW confidence / unknown deposit / fallback dataset), plus extended declaration safety proofs: no-submission guarantee covers the new assembly paths and the type-level constraint still compiles <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2], touches: [packages/core-domain/src/reliability/__tests__/**, packages/core-domain/src/declaration/__tests__/**] -->
- [x] 6.2 Write API-layer and lifecycle tests — scenario CRUD round-trip incl. upsert-by-name and flag-off 403; reports (all three formats, disclaimer presence, CSV escaping, entitlement 403 for FREE tier, flag-off 403, rate limiting); reliability endpoint shape; GDPR export includes scenarios and erasure cascades to them; real engines and repositories, no `vi.fn()` mocks, per the golden-dataset convention <!-- agent: platform-engineer.build, depends_on: [3.1, 3.2, 3.3, 3.4], touches: [packages/application-api/src/**/__tests__/**, tests/integration/**] -->
- [x] 6.3 Write the neutrality lockstep test at `packages/core-domain/src/ranking/__tests__/` — `RankingService.rank()` rejects a score-carrying input object, and the score output type shares no import path into the ranking module (mirrors the billing-isolation convention) <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/core-domain/src/ranking/__tests__/**] -->
- [x] 6.4 Run typecheck, lint, unit tests, and golden-dataset regression tests; fix fallout <!-- agent: platform-engineer.fast, depends_on: [4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3], touches: [] -->
- [ ] 6.5 Update `docs/tasks.md` — mark T2.10 through T2.13 with completion notes referencing this change <!-- agent: platform-engineer.fast, depends_on: [6.4], touches: [docs/tasks.md] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. Data model | 3 | platform-engineer |
| 2. Core domain | 2 | platform-engineer |
| 3. API layer | 5 | platform-engineer |
| 4. Frontend | 4 | platform-engineer |
| 5. Feature flag | 1 | platform-engineer |
| 6. Tests and verification | 5 | platform-engineer |
| **Total** | **20** | |

### Wave execution order (dependency-aware)

```
Wave 1 (5 tasks):   1.1, 1.3, 2.1, 2.2, 5.1
Wave 2 (4 tasks):   1.2, 3.3, 3.5, 6.3
Wave 3 (2 tasks):   3.1, 3.4
Wave 4 (2 tasks):   3.2, 6.1
Wave 5 (4 tasks):   4.1, 4.2, 4.3, 4.4
Wave 6 (1 task):    6.2
Wave 7 (1 task):    6.4
Wave 8 (1 task):    6.5
```

`ob-plan-apply` recomputes exact waves from the annotations; the sketch above is indicative only. Same-file serialization via `touches` (1.2/1.3 share `data-platform.module.ts`; 3.1/3.2 share the accounts module; 4.1/4.2/4.4 share the calculator page area) is enforced regardless of `depends_on`.

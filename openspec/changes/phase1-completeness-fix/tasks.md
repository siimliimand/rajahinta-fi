# Phase 1 Completeness Fix — Tasks

> Derived from the Phase 1 audit fix plan (`docs/phase-1-audit-fix-plan.md`) and the completeness audit (2026-08-20).

---

## 1. CI/CD Pipeline

- [x] 1.1 Create CI workflow at `.github/workflows/ci.yml` — lint, typecheck, unit tests, golden-dataset regression tests on PR and push to `main` <!-- agent: devops-engineer.build, depends_on: [], touches: [.github/workflows/ci.yml] -->
- [x] 1.2 Create staging deploy workflow at `.github/workflows/deploy-staging.yml` — build Docker image, push to registry, apply `infra/k8s/overlays/staging/` <!-- agent: devops-engineer.build, depends_on: [1.1], touches: [.github/workflows/deploy-staging.yml] -->
- [x] 1.3 Create production deploy workflow at `.github/workflows/deploy-production.yml` — manual dispatch, build image, apply `infra/k8s/overlays/production/` <!-- agent: devops-engineer.build, depends_on: [1.2], touches: [.github/workflows/deploy-production.yml] -->

## 2. Load Testing

- [x] 2.1 Add k6 as a dev dependency and create load test script at `tests/load/calculator-load.test.ts` — realistic payloads (beer, wine, spirits, basket), baseline thresholds (p95 < 2s, err < 1%, no 429s) <!-- agent: devops-engineer.build, depends_on: [], touches: [tests/load/**, package.json] -->
- [x] 2.2 Wire load test into staging deploy workflow — run against staging URL after deploy, non-blocking initially <!-- agent: devops-engineer.build, depends_on: [2.1, 1.2], touches: [.github/workflows/deploy-staging.yml] -->

## 3. Content Vocabulary Linting

- [x] 3.1 Create `ContentLintService` at `packages/data-acquisition/src/content/content-lint.service.ts` — banned-pattern list (Finnish, English, Swedish), `lintProductContent()`, `LintResult` type with warnings (not rejection) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-acquisition/src/content/**] -->
- [x] 3.2 Create ContentLintService tests at `packages/data-acquisition/src/__tests__/content-lint.service.test.ts` — each banned pattern, edge cases, neutral vocabulary passes, Finnish/Swedish patterns <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/data-acquisition/src/__tests__/content-lint.service.test.ts] -->
- [x] 3.3 Integrate linting step into `PipelineOrchestratorService` — run after DataMappingService, before UpsertPortAdapter; include violations in `PipelineRunReport` <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [packages/data-acquisition/src/services/pipeline-orchestrator.service.ts] -->
- [x] 3.4 Add frontend content-safety awareness — banned-pattern list in `apps/frontend/src/lib/content-lint.ts`, `ContentSafetyBadge` component for flagged products <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/lib/content-lint.ts, apps/frontend/src/app/**] -->

## 4. Click Analytics / Outbound Links

- [x] 4.1 Create `ClickAnalyticsService` at `packages/application-api/src/analytics/click-analytics.service.ts` — `recordClick()`, `getClickStats()`; explicitly zero purchase/commission tracking fields <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/analytics/**] -->
- [x] 4.2 Create `GET /api/v1/outbound/:offerId` redirect endpoint — records click via `ClickAnalyticsService`, 302 redirects to merchant URL, rate-limited, 404 for unknown offers <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/application-api/src/analytics/**] -->
- [x] 4.3 Replace frontend direct merchant `<a>` links with `/api/v1/outbound/:offerId` redirects — add `rel="nofollow noopener" target="_blank"` <!-- agent: platform-engineer.build, depends_on: [4.2], touches: [apps/frontend/src/app/**] -->
- [x] 4.4 Create ClickAnalyticsService tests — verify no purchase/commission fields in types, test rate limiting, test 404 for unknown offers <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/application-api/src/__tests__/click-analytics.service.test.ts] -->

## 5. Account System Persistence

- [x] 5.1 Add `accounts` and `savedBaskets` tables to Drizzle schema at `packages/data-platform/src/schema.ts` — unique ID, creation timestamp, session reference; baskets reference account ID + product IDs + quantities <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts] -->
- [x] 5.2 Create `AccountRepository` at `packages/data-platform/src/repositories/account.repository.ts` — CRUD operations implementing the existing account port interface <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/data-platform/src/repositories/account.repository.ts] -->
- [x] 5.3 Create `SavedBasketRepository` at `packages/data-platform/src/repositories/saved-basket.repository.ts` — save, list, delete basket operations <!-- agent: platform-engineer.build, depends_on: [5.1], touches: [packages/data-platform/src/repositories/saved-basket.repository.ts] -->
- [x] 5.4 Rewire `AccountService` to use PostgreSQL repositories instead of in-memory Maps — register repositories in `DataPlatformModule`, inject into AccountService <!-- agent: platform-engineer.build, depends_on: [5.2, 5.3], touches: [packages/application-api/src/accounts/account.service.ts, packages/application-api/src/accounts/account.module.ts] -->
- [x] 5.5 Run existing account system tests and verify data survives process restart — confirm baskets and history persist across restarts <!-- agent: platform-engineer.fast, depends_on: [5.4], touches: [packages/application-api/src/accounts/__tests__/**] -->

## 6. Identity-Document Audit

- [x] 6.1 Grep codebase for identity-document and date-of-birth fields — confirm zero results for `dateOfBirth`, `identityDocument`, `passport`, `henkilötunnus`, or equivalent fields in schemas and types <!-- agent: platform-engineer.fast, depends_on: [], touches: [] -->
- [x] 6.2 Document audit result and update task status — write finding to PR description or commit message; mark `docs/tasks.md` T1.61 as `[x]` <!-- agent: platform-engineer.fast, depends_on: [6.1], touches: [docs/tasks.md] -->

## 7. Task Status Corrections

- [x] 7.1 Update `docs/tasks.md` T1.23 (rate-review) to `[x]` — snapshot-based detection is functional; add note that direct vero.fi API integration is a Phase 2 enhancement <!-- agent: platform-engineer.fast, depends_on: [], touches: [docs/tasks.md] -->

## 8. Test Coverage Gaps

- [x] 8.1 Write `SourceGovernanceService` functional tests — cover registerSource, checkPermission, revokePermission, revokeSourceById, listMerchantSources, findById <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/governance/__tests__/source-governance.service.test.ts] -->
- [x] 8.2 Write `ExciseDeclarationService` functional tests — cover prepareDeclaration success, CalculationRecordNotFoundError, advance-notice logic, MyTax link assembly <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/declaration/__tests__/**] -->
- [x] 8.3 Write `DeclarationController` tests — verify delegation to ExciseDeclarationService, EntitlementGuard enforcement, error handling <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/declaration/__tests__/**] -->
- [x] 8.4 Write `RankingController` tests — verify methodology response structure matches RankingService output <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/ranking/__tests__/**] -->
- [x] 8.5 Write `EntitlementGuard` tests — verify pass with sufficient tier, 403 with insufficient tier, pass when no feature required <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/entitlement/__tests__/**] -->
- [x] 8.6 Write `InMemoryAuditRepository` tests — verify save, query with filters, getHistory, offset/limit pagination <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/audit/__tests__/**] -->
- [x] 8.7 Write `KpiService` tests — verify metric recording, buffering, auto-flush, log format <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/observability/__tests__/**] -->
- [x] 8.8 Write `CostAttributionService` tests — verify cost recording with merchant and category breakdowns <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/observability/__tests__/**] -->
- [x] 8.9 Write `TaxCalculationEngineAdapter` tests — verify delegation to LandedCostCalculatorService for calculateExcise, calculateContainerDuty, calculateLandedCost <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/adapters/__tests__/**] -->

## 9. Environment Pipeline — Staging

- [x] 9.1 Create staging-specific seed data at `packages/data-platform/src/seed/staging-seed.ts` — test merchant configs, test tax rules, distinct from production seed <!-- agent: devops-engineer.build, depends_on: [], touches: [packages/data-platform/src/seed/staging-seed.ts] -->
- [x] 9.2 Create K8s Job or init container for staging seed — runs staging seed on first staging deploy, idempotent <!-- agent: devops-engineer.build, depends_on: [9.1, 1.2], touches: [infra/k8s/**] -->
- [x] 9.3 Verify staging environment is accessible and seed data is applied — confirm staging database contains test data, not production data <!-- agent: devops-engineer.fast, depends_on: [9.2], touches: [] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. CI/CD Pipeline | 3 | devops-engineer |
| 2. Load Testing | 2 | devops-engineer |
| 3. Content Vocabulary Linting | 4 | platform-engineer |
| 4. Click Analytics / Outbound Links | 4 | platform-engineer |
| 5. Account System Persistence | 5 | platform-engineer |
| 6. Identity-Document Audit | 2 | platform-engineer |
| 7. Task Status Corrections | 1 | platform-engineer |
| 8. Test Coverage Gaps | 9 | platform-engineer |
| 9. Environment Pipeline — Staging | 3 | devops-engineer |
| **Total** | **33** | |

### Wave execution order (dependency-aware)

```
Wave 1 (no dependencies — 18 tasks):
  1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1–8.9, 9.1

Wave 2 (depends on Wave 1 — 6 tasks):
  1.2, 3.2, 3.3, 3.4, 4.2, 4.4, 5.2, 5.3, 6.2

Wave 3 (depends on Wave 2 — 6 tasks):
  1.3, 2.2, 4.3, 5.4, 9.2

Wave 4 (depends on Wave 3 — 3 tasks):
  5.5, 9.3
```
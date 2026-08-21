## Why

The Phase 1 completeness audit (2026-08-20) revealed that while 57 of 73 Phase 1 engineering tasks are fully implemented with production-quality code, 10 actionable gaps remain. Five of these are compliance-critical (content safety, merchant links) and block the launch-gating flag. Three are operational prerequisites (CI/CD, load testing, account persistence). The remaining two are documentation/status corrections and test coverage gaps. Closing these gaps is the final step before Phase 1 can be declared feature-complete and the legal-review gating flag can be evaluated.

## What Changes

- **CI/CD pipeline**: GitHub Actions workflows for automated lint, typecheck, unit tests, and golden-dataset regression tests on every PR and push.
- **Load testing**: k6/artillery-based load tests on the Landed-Cost Calculation endpoint with baseline thresholds (p95 latency, error rate).
- **Content vocabulary linting**: Automated content-safety service that scans product names and descriptions for banned subjective/promotional adjectives (Finnish, English, Swedish) and flags violations in the data acquisition pipeline.
- **Outbound merchant links**: Click-analytics redirect endpoint that records basic click-through counts without any purchase tracking, commission calculation, or affiliate infrastructure.
- **Account system persistence**: Migrate the in-memory account system (AccountService, saved baskets, calculation history, retention) to PostgreSQL-backed repositories, or explicitly accept in-memory for Phase 1 with a Phase 2 migration task.
- **Staging environment**: Staging tax-rule and merchant seed data separate from production, plus automated deployment workflow.
- **Test coverage**: Fill the gaps in governance service tests, declaration functional tests, controller/guard unit tests, and observability service tests.
- **Task status corrections**: Mark T1.23 (rate-review) and T1.61 (no identity documents) as complete — both are satisfied by the existing implementation but were left unchecked.

## Capabilities

### New Capabilities
- `ci-cd-pipeline`: GitHub Actions CI/CD workflows — automated lint, typecheck, unit tests, golden-dataset regression tests, staging deploy
- `content-vocabulary-linting`: Automated content-safety service that scans product names/descriptions for banned promotional vocabulary, integrated into the data acquisition pipeline
- `click-analytics`: Plain outbound merchant link redirect endpoint with click counting, zero purchase/commission tracking infrastructure
- `load-testing`: Performance/load tests on the Landed-Cost Calculation endpoint with defined baseline thresholds

### Modified Capabilities
- `accounts-age-gate`: Persist account system to PostgreSQL (migrate from in-memory Maps), or accept in-memory for Phase 1 with explicit migration task. Verify no identity document fields exist in schema.
- `compliance-governance`: Add content vocabulary enforcement as a pipeline step — product listings with banned promotional language are flagged in the pipeline report
- `data-acquisition`: Integrate content-linting as a quality check in the pipeline orchestrator; add staging-specific seed data
- `mvp-testing`: Add load tests to the testing strategy; fill test coverage gaps in controllers, guards, governance service, and observability services
- `web-application`: Replace direct merchant links with click-analytics redirect endpoints (plain links, no tracking)
- `product-data-model`: Add accounts and savedBaskets tables if migrating to persistent storage

## Impact

- **Code**: New files in `packages/application-api/src/analytics/`, `packages/data-acquisition/src/content/`, `tests/load/`, `.github/workflows/`. Modifications to `PipelineOrchestratorService` (lint step), frontend merchant links, and optionally `schema.ts` + repositories for account persistence.
- **APIs**: New `GET /api/v1/outbound/:offerId` redirect endpoint. No breaking API changes.
- **Dependencies**: New dev dependencies — `k6` or `artillery` for load testing.
- **Infrastructure**: GitHub Actions workflow files, staging seed data, staging deployment automation.
- **Documentation**: `docs/tasks.md` updates for T1.23 and T1.61 status corrections.
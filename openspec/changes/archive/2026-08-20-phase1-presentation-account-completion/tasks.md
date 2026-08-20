# Tasks — Phase 1 Presentation & Account Completion

## 1. Controlled vocabulary enforcement (G1 — T1.49)

- [x] 1.1 Create `apps/frontend/scripts/lint-content-policy.ts` that scans `.tsx` source files under `apps/frontend/src` for string literals, runs `checkContent()` on each, and exits non-zero listing violations with context. <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/scripts/lint-content-policy.ts] -->
- [x] 1.2 Add a `lint:content` script to `apps/frontend/package.json` and expose it from the root `package.json`. <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [apps/frontend/package.json, package.json] -->
- [x] 1.3 Add a `content-policy` job to `.github/workflows/ci.yml` running `pnpm run lint:content`, and add it as a dependency of the `ci-pass` summary job. <!-- agent: devops-engineer.build, depends_on: [1.2], touches: [.github/workflows/ci.yml] -->

## 2. Merchant link click analytics (G2 — T1.50)

- [x] 2.1 Add `ClickAnalyticsService` and `POST /api/v1/analytics/click` in `application-api` recording a click count (in-memory for Phase 1); reject any affiliate/commission/purchase payload. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/analytics/**] -->
- [x] 2.2 Add a `logClick()` helper to `apps/frontend/src/lib/api.ts` and wire the `onClick` handler into `MerchantLink` usage in `ComparisonView.tsx` and `CalculatorResult.tsx`. <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [apps/frontend/src/lib/api.ts, apps/frontend/src/app/compare/components/MerchantLink.tsx, apps/frontend/src/app/calculator/components/CalculatorResult.tsx] -->
- [x] 2.3 Tests for the click endpoint (count increment, commission-data rejection) and the frontend wiring. <!-- agent: platform-engineer.build, depends_on: [2.1,2.2], touches: [packages/application-api/src/analytics/**] -->

## 3. Functional account session + frontend (G3 — T1.60)

- [x] 3.1 Add `addCalculationToHistory()` to `AccountService` and a `POST /api/v1/account/history` endpoint in `AccountController` that appends a record ID. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/account.service.ts, packages/application-api/src/accounts/account.controller.ts] -->
- [x] 3.2 Add anonymous session support to `apps/frontend/src/lib/api.ts`: generate a UUID on first use, persist in a cookie, and send it as the `x-user-id` header on account-scoped requests. <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/lib/api.ts] -->
- [x] 3.3 Replace the disabled "Sign in"/"Create account" buttons on the account page with a functional anonymous account flow (create/continue), and add an account creation page. <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/frontend/src/app/account/page.tsx, apps/frontend/src/app/account/create/page.tsx] -->
- [x] 3.4 Build the saved-baskets UI: list, save, and delete baskets via the existing account API. <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/frontend/src/app/account/saved-baskets/page.tsx] -->
- [x] 3.5 Wire calculation-history recording on calculate, and display the history on the account page. <!-- agent: platform-engineer.build, depends_on: [3.1,3.2,3.3], touches: [apps/frontend/src/app/calculator/page.tsx, apps/frontend/src/app/account/page.tsx] -->
- [x] 3.6 Tests for history append endpoint and frontend account flows. <!-- agent: platform-engineer.build, depends_on: [3.1,3.3,3.4,3.5], touches: [packages/application-api/src/accounts/**] -->

## 4. Retention scheduled job (G4 — T1.63)

- [x] 4.1 Schedule `AccountRetentionService.purgeExpiredAccounts()` and `anonymizeInactiveAccounts()` via a cron/worker (reusing `@nestjs/schedule`), with a sensible daily cadence. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/jobs/jobs-scheduler.service.ts, packages/application-api/src/jobs/workers/account-retention.worker.ts] -->
- [x] 4.2 Tests for the retention schedule trigger. <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [packages/application-api/src/jobs/**] -->

## 5. Data export UI (G5 — T1.64)

- [x] 5.1 Replace the "Data export — Coming soon" card on the account page with a functional "Export my data" button that calls `GET /api/v1/account/export` and triggers a JSON download. <!-- agent: platform-engineer.build, depends_on: [3.2,3.3], touches: [apps/frontend/src/app/account/page.tsx, apps/frontend/src/lib/api.ts] -->

## 6. Docs resync (C1–C5)

- [x] 6.1 Check off T1.45, T1.46, T1.47, T1.48, and T1.59 in `docs/tasks.md` and note the completed state. <!-- agent: platform-engineer.fast, depends_on: [1.1,2.1,3.1,4.1,5.1], touches: [docs/tasks.md] -->

## 7. Verification

- [x] 7.1 Run full verification: typecheck, build, lint, unit, content-policy lint, golden-dataset, data-quality, compliance, e2e. <!-- agent: devops-engineer.fast, depends_on: [1.3,2.3,3.6,4.2,5.1,6.1], touches: [] -->

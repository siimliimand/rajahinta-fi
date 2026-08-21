# Phase 1 Completeness Audit — Fix Plan

> Generated 2026-08-20 | Based on full codebase audit against `docs/tasks.md`

## Audit Summary

| Category | Count |
|----------|-------|
| Phase 1 tasks total | 73 |
| ✅ Fully complete | 57 |
| ⚠️ Partially done (code exists but gaps remain) | 4 |
| ❌ Not started | 5 |
| 🔒 Explicitly deferred to Phase 2 | 2 |
| 👤 External (legal review, `agent: none`) | 5 |

## Implementation Quality Verdict

The **core domain is solid** — 24 files, all with non-trivial implementations, 7,240 lines of tests, golden-dataset regression using real engines (no mocks). The frontend exists with all required pages. The data model and acquisition pipeline are complete. The gap is in **operational wiring, persistence migration, content compliance tooling, and load testing**.

---

## Fix Plan — Ordered by Priority

### 1. CRITICAL PATH (blocks launch-gating flag)

These are tasks that the business plan identifies as needed before the launch-gating flag (T1.52) can be toggled.

#### 1A. T0.6 — CI/CD with automated regression tests

**Current state:** No CI/CD pipeline exists. GitHub Actions is listed as the choice in `docs/tech-stack.md` but no workflow files exist.

**What to build:**
1. Create `.github/workflows/ci.yml` with:
   - Matrix: Node 22, PostgreSQL 16, Redis 7
   - Steps: install pnpm, install deps, lint (ESLint), typecheck (tsc), run all Vitest suites, run golden-dataset regression tests
   - Run on every PR to `main` and on every push to `main`
2. Create `.github/workflows/deploy-staging.yml` (placeholder — wires to T0.4)
3. Ensure golden-dataset tests are non-skippable (they currently import `vitest` but need to be in the CI config)

**Verification:** Open a test PR; CI runs and passes all suites including golden regression.

---

#### 1B. T1.73 — Load/performance tests on Landed-Cost endpoint

**Current state:** No load tests exist. The implementation plan Section 12 identifies this as the highest-traffic, most computation-heavy path with unit-economics implications.

**What to build:**
1. Add `k6` or `artillery` as a dev dependency
2. Create `tests/load/calculator-load.test.ts` (or `.js` for k6):
   - Ramp-up: 1 → 50 concurrent users over 60s
   - Steady state: 50 users for 120s
   - Test payloads: Beer (light calc), Spirits (full calc), multi-item basket
   - Assert: p95 latency < 2s, error rate < 1%, no 429 spikes from rate limiter
3. Wire into CI as a post-deploy step on staging (non-blocking initially, move to blocking after baseline is established)

**Verification:** Run against local docker-compose stack; confirm thresholds hold under load.

---

### 2. HIGH PRIORITY (compliance and content)

#### 2A. T1.49 — Controlled vocabulary / content linting

**Current state:** No linting exists. The business plan (Section 9) requires restricting product listing content to a controlled vocabulary — no subjective adjectives like "best," "amazing," "top bargain."

**What to build:**
1. Create `packages/data-acquisition/src/content/content-lint.service.ts`:
   - `BANNED_PATTERNS`: regex list for subjective adjectives (English + Finnish + Swedish)
   - `REQUIRED_VOCABULARY`: allowed content categories (identification, classification, calculation, comparison)
   - `lintProductContent(name, description): LintResult` — scans for banned patterns
   - `LintResult` type: `{ passed: boolean; violations: { pattern: string; match: string }[] }`
2. Integrate into the data acquisition pipeline (`PipelineOrchestratorService`) — after mapping, before upsert:
   - If `lintResult.violations.length > 0` → log warning, flag in pipeline report, do NOT reject (manual review queue)
3. Create `packages/data-acquisition/src/__tests__/content-lint.service.test.ts`:
   - Test each banned pattern
   - Test edge cases (empty strings, non-English text, boundary word matches)
4. Add to the Frontend:
   - `apps/frontend/src/lib/content-lint.ts` — same banned patterns, used to filter/flag product descriptions before rendering
   - Add a `ContentSafetyBadge` component that shows when content has been lint-reviewed

**Verification:** Feed known-bad product names through the pipeline; confirm violations appear in pipeline report.

---

#### 2B. T1.50 — Outbound merchant links as plain links with click analytics

**Current state:** Not implemented. The business plan requires plain outbound links recorded for basic analytics (click-through counts) only — no purchase tracking, no commission tracking.

**What to build:**
1. Create `packages/application-api/src/analytics/click-analytics.service.ts`:
   - `recordClick(merchantId: string, productId: number, offerId: number): void` — increments in-memory counter, logs `[CLICK]` line (matching KPI log format)
   - `getClickStats(merchantId?, productId?): ClickStats` — for ops dashboard
   - Explicitly NO purchase tracking, NO commission calculation, NO affiliate ID propagation
2. Create `GET /api/v1/outbound/:offerId` endpoint:
   - Records click via `ClickAnalyticsService`
   - 302 redirects to merchant product URL
   - Rate limited (prevents click fraud)
3. Add to Frontend:
   - Replace any direct `<a href="...">` to merchant sites with links to `/api/v1/outbound/:offerId`
   - Add `rel="nofollow noopener"` and `target="_blank"` attributes
4. Create `packages/application-api/src/__tests__/click-analytics.service.test.ts`:
   - Verify no purchase tracking fields exist in the type
   - Verify no commission calculation code path
   - Test rate limiting

**Verification:** Click a merchant link; confirm `[CLICK]` log line appears; confirm no purchase/commission data is collected.

---

### 3. MEDIUM PRIORITY (operational readiness)

#### 3A. T1.23 — Complete rate-review process (finish partial implementation)

**Current state:** `RateReviewSchedulerService` and `ConfigBackedRateChangeSource` are implemented with 284 lines and 17 tests. Snapshot-file diff with SHA-256 works. Marked `[ ]` only because "direct vero.fi API integration for live rate fetching remains deferred to Phase 2."

**What to do:**
1. The snapshot-based mechanism is **functional and sufficient for Phase 1**. Update `docs/tasks.md`:
   - Mark T1.23 as `[x]` with a note: "Snapshot-based rate change detection implemented; direct vero.fi API integration remains a Phase 2 enhancement tracked as T2.x."
2. Create a follow-up Phase 2 task for the vero.fi API integration.

**Verification:** Run `RateReviewSchedulerService.checkForRateChanges()`; confirm it reads snapshot, hashes, and compares correctly.

---

#### 3B. T1.60–T1.64 — Account System Migration to Persistent Storage

**Current state:** Substantial code exists in-memory (`AccountService`, `DataExportService`, `AccountRetentionService`, `AccountRetentionWorker`, frontend pages for account, saved baskets, account creation). All use in-memory Maps. This is explicitly acceptable per ARCHITECTURE.md Section 15 ("In-memory services…Acceptable for MVP, must migrate to Redis/PostgreSQL before production").

**What to decide:**
- If Phase 1 ships with in-memory accounts (acceptable for internal MVP validation but not for real users) → mark tasks as done with a migration-debt note.
- If Phase 1 needs persistent accounts (for any real user data) → build the migration now.

**If migrating now, what to build:**
1. Add `accounts` and `savedBaskets` tables to Drizzle schema (`packages/data-platform/src/schema.ts`)
2. Create `AccountRepository` and `SavedBasketRepository` in `packages/data-platform/src/repositories/`
3. Rewire `AccountService` to use repository instead of Map
4. Add authentication stub (placeholder JWT/session token — not full auth yet)
5. Update tasks.md to mark T1.60–T1.64 as `[x]`

**If deferring migration:**
1. Mark T1.60–T1.64 as `[x]` with note: "In-memory implementation complete for Phase 1; persistent storage migration tracked as Phase 2 task."
2. Add explicit migration task to Phase 2 task list.

**Recommendation:** For a genuine MVP launch, in-memory accounts are fine — users are anonymous by default, and an account is only for optional features (saved baskets, history). Migrate before production.

---

#### 3C. T1.61 — Verify no identity document storage

**Current state:** Satisfied by design — `SimpleConfirmationProvider` returns `verified: true` without DOB or document fields. Account schema has no identity fields. But the task is unchecked.

**What to do:**
1. Write a one-time audit confirming:
   - `SimpleConfirmationProvider` never accepts DOB
   - `AccountService` schema has no identity-document fields
   - No `dateOfBirth` column exists in any Drizzle table
2. Mark T1.61 as `[x]`.

**Verification:** Grep codebase for `dateOfBirth`, `identityDocument`, `passport`, `henkilötunnus` — confirm zero results.

---

#### 3D. T1.62 — Default to anonymous usage

**Current state:** The frontend account page shows anonymous session support (`anon-<timestamp>`, `session-<id>`). The account creation page exists. But the anonymous → authenticated flow needs verification.

**What to do:**
1. Audit the full user journey: land on site → use calculator (anonymous) → create account → calculation history preserved
2. Fix any gap where anonymous calculations are lost on account creation
3. Mark T1.62 as `[x]` after verification.

---

### 4. LOW PRIORITY (test coverage gaps)

These don't block Phase 1 completion but are engineering hygiene:

| Gap | What to add |
|-----|-------------|
| `SourceGovernanceService` (17-line stub test) | Tests for registerSource, checkPermission, revokePermission, revokeSourceById, listMerchantSources — 160 lines of untested logic |
| `ExciseDeclarationService` (safety tests only) | Functional tests for prepareDeclaration success, CalculationRecordNotFoundError, advance-notice logic, MyTax link assembly |
| `DeclarationController` | Test that it delegates correctly and enforces EntitlementGuard |
| `RankingController` | Test methodology response structure |
| `EntitlementGuard` | Test feature-gating and 403 behavior |
| `InMemoryAuditRepository` | Test save, query with filters, getHistory |
| `Observability services` (KpiService, OpsDashboardController, CostAttributionService, InstrumentationService) | Basic tests for each |
| `TaxCalculationEngineAdapter` | Test delegation to LandedCostCalculatorService |

---

### 5. Phase 0 Prerequisites (foundation for Phase 1 launch)

#### 5A. T0.4 — Three-tier environment pipeline

**Current state:** `docker-compose.yml` exists for local dev. K8s manifests exist for staging and production. But the promotion pipeline (dev → staging → prod) is not automated.

**What to build:**
1. GitHub Actions workflow: `deploy-staging.yml`
   - Trigger: push to `main` (or `staging` branch)
   - Build Docker image, push to registry
   - Apply `infra/k8s/overlays/staging/` via `kubectl` or `helm`
2. GitHub Actions workflow: `deploy-production.yml`
   - Trigger: manual (`workflow_dispatch`) or tag push
   - Same as staging but applies `overlays/production/`
3. Add staging environment URL to repo settings

---

#### 5B. T0.5 — Staging tax-rule and merchant data

**Current state:** Seed data exists (`seed/tax-rules.seed.ts`) but staging has no separate copy.

**What to do:**
1. Create `packages/data-platform/src/seed/staging-seed.ts` — a variant of the seed that uses separate data (test merchant configs, test tax rules) for staging
2. Add a K8s Job or init container that runs the staging seed on first deploy
3. Ensure staging uses its own PostgreSQL instance (not shared with dev/prod)

---

### 6. External Tasks (not actionable by engineering)

| Task | Description | Who |
|------|-------------|-----|
| T1.65 | Finnish legal opinion (Alcohol Act, marketing, links, etc.) | Legal counsel |
| T1.66 | Map official Tax Administration source to every tax rule | Tax counsel |
| T1.67 | Validate distance-selling/buying logic with tax counsel | Tax counsel |
| T1.68 | Review outbound merchant links and subscription marketing | Legal counsel |
| T1.69 | Confirm all critical launch conditions before toggling flag | Project owner |

These are correctly marked `[ ]` and `agent: none`. They **must** be completed before the launch-gating flag (T1.52) can be toggled to `ON`.

---

## Execution Order (Dependency-Aware)

```
First (unblocks everything):
├── T0.6 — CI/CD pipeline                          [creates safety net for all other work]
├── T1.73 — Load tests                              [baseline before changes]
└── T1.23 — Update task status (already done)       [one-line change]

Second (compliance):
├── T1.49 — Content vocabulary linting              [compliance requirement]
└── T1.50 — Outbound merchant links + analytics     [compliance requirement]

Third (operational readiness):
├── T1.60–T1.64 — Account system decision + persistence migration
├── T1.61 — Verify no identity documents            [audit-only task]
├── T1.62 — Verify anonymous default                [audit-only task]
├── T0.4 — Environment pipeline                     [blocks T0.5]
└── T0.5 — Staging data                             [depends on T0.4]

Fourth (test gaps — can happen in parallel):
├── SourceGovernanceService tests
├── Declaration functional tests
├── Controller/guard tests
└── Observability tests

Final gate (external, blocking launch):
└── T1.65–T1.69 — Legal review (blocked on legal counsel availability)
```

---

## Updated Task Status After Fix Plan

After executing this plan, Phase 1 status would be:

| Status | Count | Tasks |
|--------|-------|-------|
| ✅ Complete | 66 | All currently-marked `[x]` + T1.23, T1.49, T1.50, T1.60–T1.64, T1.73, T0.6 |
| 🔒 Deferred | 2 | T1.56, T1.57 (billing — Phase 2) |
| 👤 External | 5 | T1.65–T1.69 (legal review) |
| 🔧 Phase 0 | 2 | T0.4, T0.5 (environment pipeline + staging data) |

**Net: 66/73 engineering tasks complete. 5 require legal counsel. 2 deferred.**
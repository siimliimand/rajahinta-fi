# Phase 0+1 Verification Fix — Tasks

> Derived from `docs/phase-0-1-verification-fix-plan.md` (audit 2026-08-21).
> Workstream order: 1 first (data truth), then 2/3/4 in parallel, then 5, then 6.

---

## 1. Tax dataset truth

- [ ] 1.1 Rewrite `SEED_RULES` with the official 2024 band structure — beer ≤0.5/0.5–3.5/>3.5 % (0/28.35/36.20 snt per cl ethanol), wine_still six bands (0/0.36/1.98/3.08/4.56/4.56 €/l), wine_sparkling = wine bands, intermediate 5.68/8.63, spirits 0/30.90/54.80, other_fermented = wine bands per litre of product; `appliesTo` uses half-open "> min, ≤ max" ABV semantics <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/seed/tax-rules.seed.ts] -->
- [ ] 1.2 Append `v2.0-2025` and `v3.0-2026` rule sets — 2025: intermediate >15–22 = 8.74, spirits >10 = 55.50; 2026: beer 28.75/36.71, wine 36→50 snt split into two rows (1.1.–31.3. / 1.4.– effectiveTo null), 219.02/340.70/504.97/504.97, intermediate 575.95/886.24, spirits 31.33/55.57/56.28; close v1.0-2024 (`effectiveTo` 2024-12-31) and v2.0-2025 (2025-12-31) <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/seed/tax-rules.seed.ts] -->
- [ ] 1.3 Publish the new versions through the rate-review pending→approve flow — create review entries recording manual/legal confirmation; verify no auto-publish path is taken <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-acquisition/src/services/**, packages/application-api/src/jobs/**] -->
- [ ] 1.4 Rename `FORMULA_PER_DEGREE_PLATO` → `FORMULA_PER_CENTILITRE_ETHANOL`, keep the old string accepted in `calculateAlcoholExcise` dispatch for existing DB rows, correct the `calcPerDegreePlato` doc comments (per cl of ethyl alcohol, not per degree Plato) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/tax/services/alcohol-excise.math.ts] -->
- [ ] 1.5 Re-source small-brewery relief from vero.fi pienpanimoalennus guidance — progressive 10–50 % by annual production, 15 000 000 l/year ceiling; represent as tiered `appliesTo` rows, or if the evaluator cannot express progressive tiers, ship general-rate only with small-brewery marked UNAVAILABLE <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [packages/data-platform/src/seed/tax-rules.seed.ts, packages/core-domain/src/tax/**] -->
- [ ] 1.6 Remove the `DEFAULT_RATES` numeric fallbacks (no-rule-found stays ESTIMATED, never a silent plausible number) and correct `tax-categories.ts` doc comments to official bands <!-- agent: platform-engineer.fast, depends_on: [1.4], touches: [packages/core-domain/src/tax/services/alcohol-excise.math.ts, packages/core-domain/src/tax/tax-categories.ts] -->
- [ ] 1.7 Fix effective-range predicates in `tax-rate.repository.ts` — `gt(effectiveTo, asOf)` → `lte(effectiveTo, asOf)` across all six call sites; add publish-time gap/overlap validation per (taxType, productCategory) that permits adjacent ranges (2026 intra-year split) but rejects gaps/overlaps <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/tax-rate.repository.ts] -->
- [ ] 1.8 Add boundary tests — rule expiring exactly on asOf applies; ABV band edges 0.5/2.8/5.5/8/15/18 on both sides; 31.3.2026 resolves 36 snt, 1.4.2026 resolves 50 snt for wine >1.2–2.8 % <!-- agent: platform-engineer.build, depends_on: [1.2, 1.7], touches: [packages/data-platform/src/repositories/__tests__/**] -->
- [ ] 1.9 Regenerate golden expectations from official values (bump `GOLDEN_DATASET_VERSION`; e.g. 5 % 0.5 l beer: 83 ¢ → 91 ¢ @2024, 92 ¢ @2026; 0.7 l 40 % vodka: €15.34) and add a vero.fi source-mapping comment table per expectation <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2, 1.4], touches: [tests/golden/**] -->
- [ ] 1.10 Update per-category golden tests and tax unit tests (`alcohol-excise.math.test.ts`, `alcohol-excise.service.test.ts`) to official rates and bands <!-- agent: platform-engineer.build, depends_on: [1.9], touches: [tests/golden/per-category.test.ts, packages/core-domain/src/tax/__tests__/**] -->
- [ ] 1.11 Update the rate-review snapshot consumed by `ConfigBackedRateChangeSource` to the current official table so the scheduler's baseline is reality; verify a simulated future change creates a pending review entry <!-- agent: platform-engineer.fast, depends_on: [1.2], touches: [packages/data-acquisition/src/services/**, packages/data-acquisition/config/**] -->
- [ ] 1.12 Give the container-duty rule its own vero.fi source URL and verified effective date (currently shares the excise citation) <!-- agent: platform-engineer.fast, depends_on: [], touches: [packages/data-platform/src/seed/tax-rules.seed.ts] -->

## 2. CI/CD that actually runs

- [ ] 2.1 Fix branch triggers `main` → `master` in `.github/workflows/ci.yml` and `.github/workflows/deploy-staging.yml` (default branch is `master`; PRs #16/#17 merged there) <!-- agent: devops-engineer.fast, depends_on: [], touches: [.github/workflows/ci.yml, .github/workflows/deploy-staging.yml] -->
- [ ] 2.2 Restore the lost CI jobs from commit 0e2fe9b — `build`, `data-quality`, `compliance`, `content-policy` — plus a `ci-pass` gate job requiring all jobs <!-- agent: devops-engineer.build, depends_on: [2.1], touches: [.github/workflows/ci.yml] -->
- [ ] 2.3 Add `pnpm test:e2e` as a CI job gated on the e2e repair <!-- agent: devops-engineer.build, depends_on: [2.2, 3.2], touches: [.github/workflows/ci.yml] -->
- [ ] 2.4 Correct `docs/staging-verification.md` load-test section — remove `k6 run tests/load/calculator-load.test.ts` and `npm install -g k6` instructions; document `pnpm test:load` as an in-process benchmark; either add a real artillery HTTP smoke against `STAGING_URL` or remove the artillery devDependency and the unused env <!-- agent: devops-engineer.fast, depends_on: [], touches: [docs/staging-verification.md, .github/workflows/deploy-staging.yml, package.json] -->
- [ ] 2.5 Make the staging seed-Job lifecycle explicit (create → wait → re-runnable) instead of delete-then-wait-for-kustomize, and bring production deploy env/secrets handling to staging's level <!-- agent: devops-engineer.build, depends_on: [2.1], touches: [.github/workflows/deploy-staging.yml, .github/workflows/deploy-production.yml, infra/k8s/**] -->

## 3. E2E repair

- [ ] 3.1 Alias `@rajahinta/application-api` and `@rajahinta/data-platform` to their `src/` in `vitest.config.e2e.ts` (same treatment as core-domain/frontend) so NestJS DI sees one class identity per class <!-- agent: platform-engineer.fast, depends_on: [], touches: [vitest.config.e2e.ts] -->
- [ ] 3.2 Replace the local `TRANSPORT_OFFER_QUERY` string token with the exported domain constant, update expected values to official rates, and get all 16 tests executing and green (0 skipped, exit 0) <!-- agent: platform-engineer.build, depends_on: [3.1, 1.9], touches: [apps/backend/tests/e2e/calculator.test.ts] -->

## 4. Accounts & GDPR

- [ ] 4.1 Implement `anonymizeAccount()` for DB mode — irreversible pseudonymization of identifiers via `AccountRepository` (anonymized skeleton retained for referential integrity), cascade to saved baskets, audit event recorded; unit + integration tests <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/**, packages/data-platform/src/repositories/account.repository.ts] -->
- [ ] 4.2 Fail-fast in `AccountService` when repositories are not injected outside test environments (keep `@Optional()` only for the in-memory test harness) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/accounts/account.service.ts] -->
- [ ] 4.3 Verify export, erasure, and retention end-to-end against PostgreSQL — erasure leaves no recoverable identifiers; retention worker and export operate on persisted data <!-- agent: platform-engineer.build, depends_on: [4.1, 4.2], touches: [packages/application-api/src/accounts/__tests__/**, packages/application-api/src/jobs/workers/**] -->

## 5. Correctness gaps

- [ ] 5.1 Wire `AuditService.logChange()` into the rate-review publish/approve flow, classification rule-set version publication, and ranking-logic change paths — before/after + actor recorded; tests assert each <!-- agent: platform-engineer.build, depends_on: [1.3], touches: [packages/application-api/src/audit/**, packages/core-domain/src/governance/**, packages/core-domain/src/ranking/**] -->
- [ ] 5.2 Unify the reliability vocabulary — eliminate the `EXACT` value of `DataReliability`, keep `ReliabilityStatus` (VERIFIED/STALE/UNAVAILABLE/ESTIMATED) as the single vocabulary, type `reliabilityStatus` as the union instead of `string`, remove the ad-hoc EXACT→VERIFIED mapping <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/reliability/**, packages/core-domain/src/index.ts, packages/core-domain/src/calculator/**] -->
- [ ] 5.3 Add `transportArrangement` (SELLER_ARRANGED | INDEPENDENT_CARRIER | PERSONAL) to `CalculatorInput`, feed it into `TransactionClassificationService` replacing the hardcoded `buyerIsTravelling: false`, and return the TravellerImport outcome with its excluded-from-calculator messaging <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/calculator/**, packages/core-domain/src/classification/**] -->
- [ ] 5.4 Add an e2e test for the personal-transport case asserting the TravellerImport classification and its messaging <!-- agent: platform-engineer.build, depends_on: [5.3, 3.2], touches: [apps/backend/tests/e2e/calculator.test.ts] -->
- [ ] 5.5 Include resolved dataset versions (tax + transport) in `idempotency.service.ts` `hashInput()` (keep lookup-time comparison as defence in depth); test that same input + new tax version ⇒ fresh calculation, never a stale cache hit <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/idempotency/**] -->
- [ ] 5.6 Add a ranking-methodology lockstep test — `GET /api/v1/ranking/methodology` output is generated from the same source as RankingService's actual sort descriptions, failing when one drifts <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/ranking/__tests__/**, tests/compliance/**] -->
- [ ] 5.7 Enumerate every controller exposing alcohol-content data, enforce `AgeGateGuard` on each, and add a coverage test that fails when a new alcohol-content route ships unguarded <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/**/__tests__/**, packages/application-api/src/**/**.controller.ts] -->
- [ ] 5.8 Build the correction flag UI — "Flag a problem" affordance on the calculator result page posting to `POST /api/v1/corrections` with recordId/context, plus a link from the methodology page <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/frontend/src/app/calculator/**, apps/frontend/src/app/ranking/**, apps/frontend/src/lib/api.ts] -->

## 6. Documentation truth

- [ ] 6.1 Resync `docs/tasks.md` checkboxes to verified reality — check T0.4/T0.5/T0.6, T1.49, T1.50, T1.60, T1.62–T1.64 once their workstreams land; annotate T1.22 that v1.0-2024 values were superseded by the corrected versioned datasets <!-- agent: platform-engineer.fast, depends_on: [1.9, 2.3, 3.2, 4.3], touches: [docs/tasks.md] -->
- [ ] 6.2 Update `ARCHITECTURE.md` §15 known-debt (remove closed items, add anything remaining) and record the schema source-of-truth decision <!-- agent: platform-engineer.fast, depends_on: [5.1, 5.8], touches: [ARCHITECTURE.md] -->
- [ ] 6.3 Implement the single schema source of truth — either generate committed Drizzle migrations from `schema.ts` and drop `infra/staging-data/schema.sql` from the deploy path, or the reverse; document the choice <!-- agent: platform-engineer.build, depends_on: [6.2], touches: [packages/data-platform/src/schema.ts, infra/staging-data/**, infra/k8s/**] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. Tax dataset truth | 12 | platform-engineer |
| 2. CI/CD | 5 | devops-engineer |
| 3. E2E repair | 2 | platform-engineer |
| 4. Accounts & GDPR | 3 | platform-engineer |
| 5. Correctness gaps | 8 | platform-engineer |
| 6. Documentation truth | 3 | platform-engineer |
| **Total** | **33** | |

### Wave execution order (dependency-aware)

```
Wave 1 (no dependencies — 14 tasks):
  1.1, 1.4, 1.7, 1.12, 2.1, 2.4, 3.1, 4.1, 4.2, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8
Wave 2 (depends on Wave 1 — 10 tasks):
  1.2, 1.6, 2.2, 2.5, 3.2*, 5.1   (*3.2 also needs 1.9 → later wave)
Wave 3:
  1.3, 1.5, 1.9, 1.11, 2.3, 4.3, 5.4
Wave 4:
  1.8, 1.10, 6.1, 6.2
Wave 5:
  6.3
```

Out of scope: T1.65–T1.69 (manual legal tasks — engage Finnish counsel per
`docs/legal-tasks-guide.md`).

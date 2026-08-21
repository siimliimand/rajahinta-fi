## Why

The Phase 0 + Phase 1 verification audit (2026-08-21, `docs/phase-0-1-verification-fix-plan.md`) found that while large parts of Phase 1 are correctly implemented, the phases cannot be declared done: the core tax dataset contradicts the official vero.fi rate table in nearly every category, the dataset is two years stale while claiming to be current law, CI and staging deploy have never run (wrong branch triggers), the e2e suite cannot execute, and GDPR erasure is a no-op against PostgreSQL. Because the golden/unit/e2e tests hardcode the same wrong rates, the entire test suite passes on legally incorrect data — a garbage-in consensus that masks the platform's highest-severity risk (incorrect tax information shown to users).

Key audit findings addressed by this change:

- **C1** Seeded excise rates wrong vs official table: spirits 29.50 vs 54.80 €/l pure alcohol (−46 %), beer 33.00 vs 36.20 snt/cl plus wrong legal basis label (°Plato vs cl ethanol) and a missing 0.5–3.5 % tier, wines 3.40 €/l flat vs the official 4-band structure (1.98/3.08/4.56/0.36), fabricated sparkling-wine category, intermediates −40…−47 %, small-brewery relief flat 50 % @ "100 000 hl" vs the official progressive 10–50 % scheme with a 15 M litre ceiling.
- **C2** `v1.0-2024` dataset has `effectiveTo: null` (claimed current forever) in 2026; official 2025 and 2026 tables differ, including an intra-year change on 1.4.2026.
- **C3** `ci.yml` and `deploy-staging.yml` trigger on `main` but the default branch is `master` — zero CI enforcement; the current minimal ci.yml also lost the build/data-quality/compliance/content-policy jobs present in the version it replaced.
- **C4** `pnpm test:e2e` fails at suite setup (dual src/dist class identities); all 16 tests skip.
- **H1/H2** `anonymizeAccount()` is a no-op in DB mode; `AccountService` silently falls back to in-memory storage if DI fails.
- **H3** Correction mechanism has no user-facing UI despite being one of the three launch gates.
- **M1–M8** `effectiveTo` boundary exclusion, audit trail never written (zero `logChange` call sites), dual reliability vocabulary (`EXACT` vs `VERIFIED`), TravellerImport unreachable, idempotency key excludes dataset versions, load-test documentation claims a k6 flow that cannot work, ranking-lockstep coverage unverified, age-gate guard coverage unverified.

Out of scope: T1.65–T1.69 (manual legal/owner tasks per `docs/legal-tasks-guide.md`).

## What Changes

- **Tax dataset truth**: rewrite the seed with the official vero.fi band structure per category; add versioned `v2.0-2025` and `v3.0-2026` rule sets (including the 1.4.2026 intra-year split) published through the existing rate-review pending→approve flow; close `v1.0-2024`/`v2.0-2025` with `effectiveTo`; re-source the small-brewery relief from the official progressive scheme; rename the `PER_DEGREE_PLATO` formula constant to per-centilitre-of-ethanol semantics; correct or remove the `DEFAULT_RATES` fallbacks; regenerate golden/per-category/unit/e2e expectations from official values.
- **Repository integrity**: inclusive `effectiveTo` boundary semantics, gap/overlap validation at publish, boundary tests (expiry-date equality, ABV band edges, the 2026 intra-year change).
- **CI/CD that actually runs**: triggers `main`→`master`; restore the lost build/data-quality/compliance/content-policy jobs plus a `ci-pass` gate; add e2e to CI; fix the load-testing documentation and workflow env; make the staging seed-Job sequence explicit.
- **E2E repair**: alias all workspace packages to `src` in the e2e vitest config (single class identity); use the exported transport-offer token; 16/16 green.
- **Accounts & GDPR**: implement erasure for the PostgreSQL wiring (irreversible pseudonymization + cascade + audit event); fail-fast outside test environments when repositories are not injected; verify export/erasure/retention end-to-end.
- **Correctness gaps**: wire audit logging into rate publication, rule-set publication, and ranking changes; unify the reliability vocabulary; add `transportArrangement` to the calculator input so TravellerImport is reachable; include dataset versions in the idempotency key; add a ranking-methodology lockstep test; enumerate and enforce the age-gate guard; build the user-facing correction flag UI.
- **Documentation truth**: resync `docs/tasks.md` to verified reality (annotate T1.22), update `ARCHITECTURE.md` known-debt, decide and implement a single schema source of truth.

## Capabilities

### Modified Capabilities

- `tax-duty-engine`: official-rate band structure per category, multi-year versioned datasets with correct effective ranges, inclusive end-date semantics, re-sourced small-brewery relief, corrected formula constant naming and fallback rates
- `ci-cd-pipeline`: triggers on the repository's actual default branch (`master`); full job set (build, data-quality, compliance, content-policy, e2e) with a `ci-pass` gate; explicit staging seed-Job lifecycle
- `mvp-testing`: e2e suite executes (no skipped tests, no dual class identities); golden expectations derived from official rates with a source-mapping table; boundary tests; ranking-methodology lockstep test
- `accounts-age-gate`: functional right-to-erasure against PostgreSQL; no silent in-memory fallback outside tests
- `compliance-governance`: audit logging actually invoked on high-liability changes (rate publication, rule-set publication, ranking changes)
- `confidence-framework`: single reliability vocabulary — the `EXACT` alias is eliminated
- `landed-cost-calculator`: `transportArrangement` input replaces the hardcoded `buyerIsTravelling: false`
- `transaction-classification`: TravellerImport outcome reachable through the calculator with correct user messaging
- `correction-mechanism`: user-facing flag UI completing the end-to-end correction flow (a launch-gate condition)
- `load-testing`: documentation and workflow describe what actually runs; in-process benchmark vs HTTP-level claims no longer conflated
- `application-api`: idempotency cache key includes dataset versions (or proven complete lookup comparison); age-gate guard coverage across all alcohol-content endpoints
- `web-application`: correction flag affordance on the calculator result page and methodology page link

No new capabilities.

## Impact

- **Code**: `packages/data-platform/src/seed/tax-rules.seed.ts` (rewritten dataset), `packages/data-platform/src/repositories/tax-rate.repository.ts`, `packages/core-domain/src/tax/**` (formula constant, fallbacks, docs, tests), `packages/core-domain/src/calculator/**` (transportArrangement, reliability vocabulary), `packages/core-domain/src/classification/**`, `packages/application-api/src/accounts/account.service.ts`, `packages/application-api/src/idempotency/idempotency.service.ts`, audit wiring in review/publish flows, `apps/backend/tests/e2e/calculator.test.ts`, `vitest.config.e2e.ts`, `apps/frontend/src/app/**` (correction UI), `.github/workflows/ci.yml` + `deploy-staging.yml`.
- **Data**: new append-only `taxRules` versions (v2.0-2025, v3.0-2026); `v1.0-2024`/`v2.0-2025` closed via `effectiveTo`. No in-place rate edits — corrections ship as new versioned entries through the rate-review gate, so the eventual T1.66 legal sign-off covers the new versions.
- **Tests**: golden dataset version bump (`GOLDEN_DATASET_VERSION`); expected values change wherever they encoded the wrong rates (e.g. 5 % 0.5 l beer excise 83 ¢ → 91 ¢ for 2024, 92 ¢ for 2026).
- **Infrastructure**: CI regains enforcement on `master`; staging deploy becomes reachable; production/staging env parity improved.
- **Documentation**: `docs/tasks.md` resync, `ARCHITECTURE.md` §15, `docs/staging-verification.md` load-test section, schema source-of-truth decision.
- **Dependencies**: none added; unused `artillery` devDependency either gains a real HTTP smoke script or is removed.

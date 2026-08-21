# Phase 0+1 Runtime Composition Fix — Tasks

> Derived from `docs/phase-0-1-verification-round-2.md` (round-2 audit, 2026-08-21).
> Workstream order: 1 and 2 first (they gate PR #18), then 3, then 4/5 in
> parallel, 6 last. Single-owner rule for the in-flight working tree until 1.1
> lands.

---

## 1. Composition fix (WS-A — N1, N4)

- [x] 1.1 Finish the `forRoot` refactor — `ApplicationApiModule.forRoot` / `CoreDomainModule.forRoot` / `CalculatorModule.forRoot` / `TaxModule.forRoot` with fresh undecorated module identities, concrete port providers registered inside the consuming module's scope; static modules keep null bindings for tests; backend composition root is the sole configurator (design D1) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/index.ts, packages/application-api/src/ranking/ranking.module.ts, packages/core-domain/src/index.ts, packages/core-domain/src/calculator/calculator.module.ts, packages/core-domain/src/tax/tax.module.ts, apps/backend/src/app.module.ts] -->
- [ ] 1.2 Fix the e2e `RateLimitingModule2`/`RateLimitGuard2` double-identity failure and resolve the pnpm linker conflict — either revert `nodeLinker: hoisted`/`resolvePeersFromWorkspaceRoot` (keeping the a8f353b lockfile dedupe) or commit the linker with a regenerated lockfile and extended `@nestjs/core` aliasing; clean-install local run must match CI (design D4) <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [pnpm-workspace.yaml, pnpm-lock.yaml, vitest.config.e2e.ts, apps/backend/tests/e2e/calculator.test.ts] -->
- [ ] 1.3 Composition-root smoke test — boot the real `AppModule` (DB faked at the repository boundary only), assert via `ModuleRef` non-null `PRODUCT_DATA_PORT`/`CALCULATION_RECORD_PORT`/`TAX_RULE_REPOSITORY_PORT`, run one real `calculate()`; add as a required CI check aggregated into `ci-pass` <!-- agent: platform-engineer.build, depends_on: [1.1, 1.2], touches: [apps/backend/tests/composition/**, .github/workflows/ci.yml] -->
- [x] 1.4 Hygiene — delete `diag-tmp.mjs` (scratch files belong under `.opencode/.tmp/`), fix the `package.json` `\u2014` description escape, land or shelve the remaining working-tree diff with a message describing the N1/N2 fix <!-- agent: platform-engineer.fast, depends_on: [1.1], touches: [diag-tmp.mjs, package.json] -->

## 2. taxType vocabulary unification (WS-B — N2, N8)

- [x] 2.1 Export `TAX_TYPES` / `TaxType` from core-domain and use it at the engine call site (`alcohol-excise.service.ts`), in `tax-rules.seed.ts`, both staging placeholders, and the golden/e2e fixtures — no tax-type string literals remain outside the constant <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/tax/**, packages/data-platform/src/seed/**, tests/golden/helpers/**, apps/backend/tests/e2e/**] -->
- [x] 2.2 Committed Drizzle data migration `UPDATE tax_rules SET tax_type = 'excise' WHERE tax_type = 'excise_duty'` (version-label skip logic will not repair seeded rows), plus doc-comment corrections in `schema.ts`, `repository-registry.interface.ts`, `tax-rule-query.service.ts` <!-- agent: platform-engineer.build, depends_on: [2.1], touches: [packages/data-platform/src/drizzle/**, packages/data-platform/src/schema.ts, packages/data-platform/src/interfaces/repository-registry.interface.ts, packages/core-domain/src/tax/services/tax-rule-query.service.ts] -->
- [ ] 2.3 Real-stack integration test — throwaway Postgres + `drizzle-kit migrate` + `seedTaxRules` + `AlcoholExciseService` through the real `DrizzleTaxRateRepository`; assert 2024 beer 5 % 0.5 l = 91 snt, wine >1.2–2.8 % = 36→50 snt/l across 1.4.2026, spirits 2026 >10 % = 56.28 snt/cl; wire as a CI job (Postgres service like data-quality) <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2], touches: [tests/integration/**, .github/workflows/ci.yml] -->

## 3. Deploy migrations + official seed wiring (WS-C — N3)

- [x] 3.1 Migrate Job/step (deployed image, `drizzle-kit migrate` with psql fallback) in `deploy-staging.yml` and `deploy-production.yml`, sequenced migrate → seed → rollout; runs before any seed Job or rollout <!-- agent: devops-engineer.build, depends_on: [], touches: [.github/workflows/deploy-staging.yml, .github/workflows/deploy-production.yml, infra/k8s/base/migrate-job.yaml, infra/k8s/overlays/**] -->
- [x] 3.2 Wire the official dataset into the staging seed — `seed-runner` seeds `SEED_RULES` (v1.0-2024…v3.0-2026) alongside the isolated v9999 placeholders; production stays merchant-empty (design D3) <!-- agent: platform-engineer.build, depends_on: [2.1, 3.1], touches: [packages/data-platform/src/seed/**] -->
- [x] 3.3 Raise production deploy env/secret handling to the staging workflow's level <!-- agent: devops-engineer.build, depends_on: [], touches: [.github/workflows/deploy-production.yml] -->
- [ ] 3.4 Require the `CI passed` check on `master` PRs — apply the GitHub settings change and document it in the round-2 doc <!-- agent: devops-engineer.fast, depends_on: [1.3], touches: [docs/phase-0-1-verification-round-2.md] -->

## 4. Staging truth + docs (WS-D — N5, N7, N8)

- [ ] 4.1 Eliminate the stale legacy SQL dataset — regenerate `infra/staging-data/seed.sql` from `SEED_RULES` via a small export script, or delete it and point `scripts/test-data-quality.sh` at a generated fixture; remove the dead `GOLDEN_DATASET_PATH` env from `ci.yml` <!-- agent: platform-engineer.fast, depends_on: [3.2], touches: [infra/staging-data/**, scripts/test-data-quality.sh, .github/workflows/ci.yml] -->
- [ ] 4.2 Documentation truth — `docs/staging-verification.md` §3b/4 (isolation = no production merchant data; expected tax labels v1.0-2024…v3.0-2026 + v9999), `docs/tasks.md` T0.4 annotation, ARCHITECTURE §15 debt resync, round-1 plan round-2 addendum pointer <!-- agent: platform-engineer.fast, depends_on: [3.2, 4.1], touches: [docs/**, ARCHITECTURE.md] -->
- [x] 4.3 Transport reliability at the producer — emit the canonical `ReliabilityStatus` from the transport estimator and delete the ad-hoc `EXACT`→`VERIFIED` bridge, or record the bridge as accepted debt in ARCHITECTURE §15 (design D6) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/transport/**, packages/core-domain/src/calculator/landed-cost-calculator.service.ts] -->

## 5. HTTP load test (WS-E — N6, T1.73)

- [x] 5.1 Artillery HTTP load suite on the calculator endpoint — ramp 1→50 over 60 s, steady 50 for 120 s, beer/spirits/basket payload profiles; thresholds p95 < 2 s, error rate < 1 %, zero 429s in the steady window; add `artillery` as a devDependency <!-- agent: devops-engineer.build, depends_on: [], touches: [tests/load/**, package.json] -->
- [x] 5.2 Wire the suite as a post-deploy step in `deploy-staging.yml` (non-blocking until baseline), document the command in `docs/staging-verification.md` §5, check T1.73 in `docs/tasks.md` after first successful staging run <!-- agent: devops-engineer.build, depends_on: [5.1, 3.1], touches: [.github/workflows/deploy-staging.yml, docs/staging-verification.md, docs/tasks.md] -->

## 6. Final gate (WS-F)

- [ ] 6.1 Full verification — clean-install `pnpm install --frozen-lockfile && pnpm test && pnpm test:e2e && pnpm test:golden` green locally and in CI; `grep -r "excise_duty"` matches only migration history; fresh-DB staging deploy drill produces schema + v1.0-2024…v3.0-2026 + healthy backend; PR #18 ready to merge with this change included <!-- agent: platform-engineer.fast, depends_on: [1.3, 2.3, 3.2, 4.1, 4.2, 5.2], touches: [] -->

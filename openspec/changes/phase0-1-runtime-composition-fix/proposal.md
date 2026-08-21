# Phase 0+1 Runtime Composition Fix

## Why

The round-2 verification audit (2026-08-21 evening, `docs/phase-0-1-verification-round-2.md`) confirmed that all 33 items from the round-1 fix plan are genuinely implemented — official vero.fi rates for v1.0-2024/v2.0-2025/v3.0-2026, inclusive `effectiveTo` boundaries with 36 repository tests, CI live on `master` with the full job set, GDPR erasure, audit wiring, TravellerImport reachability, lockstep and age-gate coverage, correction UI. But the audit also found that the phases are still not correctly implemented **as a running system**, because of defects round 1 never looked at — the composition and wiring between the parts:

- **N1 (critical)** The real `AppModule` injects null ports into the calculator and excise engine. `CalculatorModule` and `TaxModule` bind `PRODUCT_DATA_PORT`, `CALCULATION_RECORD_PORT`, and `TAX_RULE_REPOSITORY_PORT` to `useValue: null` inside their own scope; the real adapters are registered only in the root module, which NestJS module-scope resolution never reaches. Every test suite assembles its own DI graph and overrides the ports, so CI is fully green while any calculation through the composed backend throws. No test boots the real `AppModule`.
- **N2 (critical)** The excise engine queries `taxType = 'excise'`; every seed path stores `'excise_duty'` (26 rows + staging placeholders). No translation layer exists. Golden/e2e fixtures happen to seed `'excise'`, masking the split; and because `DEFAULT_RATES` fallback is 0 with ESTIMATED reliability, a real-database lookup that matches nothing silently returns €0.00 excise.
- **N3 (high)** The corrected official dataset has no execution path: nothing imports `seedTaxRules`/`SEED_RULES`; no deploy workflow runs the Drizzle migrations, so a fresh staging or production database gets no schema; the staging seed Job seeds only fake v9999 placeholders, so T0.5's "realistic staging tax data" is unmet.
- **N4 (high)** An uncommitted, half-finished refactor addressing N1/N2 sits in the working tree (11 modified + 3 untracked files), with a `nodeLinker: hoisted` change that broke local e2e while CI passes the same commit, and a scratch diagnostic at the repo root.
- **N5 (medium)** `infra/staging-data/seed.sql` still encodes the pre-round-1 wrong rates and is the only real-Postgres seed, loaded by the CI data-quality job; `GOLDEN_DATASET_PATH` in ci.yml is dead.
- **N6 (medium)** T1.73 (HTTP-level load test on the landed-cost endpoint) remains unbuilt.
- **N7/N8 (low)** Transport reliability still bridges `EXACT`→`VERIFIED` ad hoc; several doc comments still document `"excise_duty"` as the discriminator.

Out of scope: T1.65–T1.69 (manual legal/owner tasks per `docs/legal-tasks-guide.md`).

## What Changes

- **Composition fix (N1)**: finish the `forRoot` refactor already started in the working tree — `ApplicationApiModule.forRoot`/`CoreDomainModule.forRoot`/`CalculatorModule.forRoot`/`TaxModule.forRoot` returning fresh undecorated module identities with the real port providers registered inside the consuming module's scope. Static modules keep null bindings for tests only; the backend composition root becomes the sole configurator. A new composition-root smoke test boots the real `AppModule` and asserts non-null ports via `ModuleRef` plus one real calculation — the test class that would have caught N1.
- **Vocabulary unification (N2)**: a single exported `TAX_TYPES` constant / `TaxType` union from core-domain used by the engine call site, the seed, staging placeholders, and all fixtures; a committed Drizzle **data migration** `UPDATE tax_rules SET tax_type = 'excise' WHERE tax_type = 'excise_duty'` (the seed's versionLabel skip logic will not repair already-seeded rows); corrected doc comments. A new real-stack integration test applies migrations to a throwaway Postgres, runs `seedTaxRules`, and calculates through the real `DrizzleTaxRateRepository` asserting official values — the only test where engine vocabulary and seed vocabulary must agree through the real query path, permanently killing the fixture-consensus masking class.
- **Deploy migrations + official seed wiring (N3)**: a migrate step/Job (same image, `drizzle-kit migrate`) in both deploy workflows, sequenced migrate → seed → rollout; the staging seed includes the official `SEED_RULES` dataset alongside clearly-marked placeholders; production applies migrations but seeds no fake data; production deploy env/secret handling raised to staging's level; `CI passed` required on `master` PRs.
- **Staging truth + docs (N5, N7, N8)**: regenerate `infra/staging-data/seed.sql` from `SEED_RULES` (or delete it in favour of a generated fixture) and drop the dead env var; update `docs/staging-verification.md` isolation semantics; `docs/tasks.md` T0.4 annotation; ARCHITECTURE §15 debt resync; transport reliability unified at the producer or the bridge recorded as accepted debt.
- **HTTP load test (N6, T1.73)**: artillery suite against the calculator endpoint (ramp 1→50 over 60 s, steady 120 s, beer/spirits/basket payloads, p95 < 2 s, errors < 1 %, zero 429s in steady window), wired as a non-blocking post-deploy staging step until a baseline exists.
- **Process (N4)**: resolve the pnpm linker conflict so local runs match CI; delete the root-level scratch diagnostic; the in-flight refactor is landed or shelved as part of this change with no parallel sessions editing the same files.

## Capabilities

### Modified Capabilities

- `tax-duty-engine`: single `TAX_TYPES` vocabulary across engine, seed, and fixtures; data migration repairing seeded rows; the official dataset seeded through a real execution path in every environment
- `application-api`: composition root injects real ports via `forRoot`; no null-port binding reachable from the backend module graph; tests override ports only through the standard override mechanism
- `ci-cd-pipeline`: deploy workflows run schema migrations before seed/rollout; a fresh-database deploy ends with schema present and official tax versions seeded (staging); CI includes the composition smoke test and the real-stack integration test
- `mvp-testing`: composition-root smoke test (boots the real AppModule, asserts port wiring, runs one calculation) and real-stack integration test (migrations + seed + engine through real Postgres) as permanent regression gates
- `load-testing`: HTTP-level artillery suite on the landed-cost endpoint with explicit thresholds, executed as a post-staging-deploy step

No new capabilities.

## Impact

- **Code**: `packages/application-api/src/index.ts`, `packages/application-api/src/ranking/ranking.module.ts`, `packages/core-domain/src/index.ts`, `packages/core-domain/src/calculator/calculator.module.ts`, `packages/core-domain/src/tax/tax.module.ts`, `packages/core-domain/src/tax/**` (TAX_TYPES, doc comments), `packages/core-domain/src/transport/**` (reliability producer), `apps/backend/src/app.module.ts`, `packages/data-platform/src/seed/**` (seed-runner includes SEED_RULES), `packages/data-platform/src/drizzle/**` (new data migration), `packages/data-platform/src/repositories/effective-range-validator.ts` (already extracted in the working tree), `pnpm-workspace.yaml`/`pnpm-lock.yaml` (linker decision).
- **Data**: `UPDATE tax_rules SET tax_type='excise' WHERE tax_type='excise_duty'` as a versioned Drizzle data migration; staging databases gain v1.0-2024…v3.0-2026 rows on next deploy. No in-place rate edits; the dataset values themselves are already correct and unchanged by this change.
- **Tests**: new composition suite (`apps/backend/tests/composition/`), new integration suite (`tests/integration/`), new artillery load suite (`tests/load/`); existing fixtures switch from string literals to the shared constant (no expected-value changes — the numbers already match vero.fi).
- **Infrastructure**: both deploy workflows gain a migrate Job; ci.yml gains two test jobs and loses a dead env var; `infra/staging-data/seed.sql` regenerated or removed.
- **Documentation**: `docs/staging-verification.md` (§3b/4 isolation semantics, §5 load test), `docs/tasks.md` (T0.4 note, T1.73 check), `ARCHITECTURE.md` §15, round-1 plan gets a round-2 addendum pointer.
- **Dependencies**: `artillery` returns as a devDependency (it was removed as unused in round 1); no runtime dependencies added.

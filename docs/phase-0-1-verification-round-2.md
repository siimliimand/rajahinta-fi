# Phase 0 + Phase 1 Verification, Round 2 — Runtime Composition Audit

> Audit date: 2026-08-21 (evening session)
> Scope: same as round 1 (`docs/phase-0-1-verification-fix-plan.md`): Phase 0 and
> Phase 1 against `docs/rajahinta-fi-implementation-plan.md` and `docs/tasks.md`,
> excluding manual legal tasks T1.65–T1.69.
> Baseline audited: committed HEAD `a8f353b` on `feature/phase0-1-verification-fix`
> (PR #18), plus the uncommitted working-tree refactor found on top of it.

## Verdict

**Phase 0: implemented except for one deploy-pipeline gap (no schema-migration
step, N3). Phase 1: not correctly implemented as a running system.**

Round 1's 33 tracked items are genuinely done (verified below). But two
cross-cutting defects that were outside round 1's item list mean the composed
backend cannot produce a correct calculation today:

- **N1** The real AppModule injects null ports into the calculator and the excise
  engine (NestJS module-scope resolution). Every unit/e2e test assembles its own
  DI graph, so every suite is green while the production wiring is broken.
- **N2** The excise engine queries `taxType = 'excise'`; every seed path stores
  `'excise_duty'`. Test fixtures happen to seed `'excise'`, which masks the split.

Additionally, the corrected official dataset (`tax-rules.seed.ts`) has **no
execution path at HEAD**: nothing imports `seedTaxRules`/`SEED_RULES` outside
comments, so no real database ever receives it.

## Verification method

| Check | Result |
|---|---|
| `pnpm typecheck` | pass (working tree) |
| CI on PR #18 head `a8f353b` (all 10 checks incl. e2e, golden, data-quality, compliance, load) | pass, confirmed via GitHub |
| `pnpm --filter @rajahinta/data-platform test` at HEAD | pass 37/37 |
| Same on the uncommitted working tree | initially fail (seed self-check grouping), later pass after the file changed mid-audit (see N4) |
| `pnpm test:e2e` locally (both HEAD and working tree) | fail in this checkout: `RateLimitingModule2` DI error, 17 tests skipped. CI passes the same commit, so this is local node_modules drift caused by the uncommitted `nodeLinker: hoisted` change |
| Seed rates vs official vero.fi table (fetched live this session) | v1.0-2024, v2.0-2025, v3.0-2026 all match, including the 2025/2026 spirits split, the 1.4.2026 wine 1.2–2.8 split, and the 2026 spirits 1.2–2.8 rate 31.33 snt/cl |
| Repo state | 11 modified files + 3 untracked, uncommitted, mid-refactor |

Official source: vero.fi alcohol excise table (page version 11.6.2026), fetched
2026-08-21.

## Confirmed done since round 1 (spot-verified)

- Official dataset values and band structure for all three versions, with
  correct units per formula; container duty 0.51 EUR/l with its own source.
- `effectiveTo` boundaries inclusive (`lte(effectiveFrom, asOf)` +
  `gte(effectiveTo, asOf)`) with 36 repository tests incl. 31.3./1.4.2026
  adjacency and ABV edges.
- Golden expectations use official values (5 % 0.5 l beer 2024 = 91 snt).
- CI triggers on `master`, full job set (lint, content-policy, build, unit,
  golden, data-quality, compliance, e2e) plus `ci-pass` gate; deploy-staging
  triggers on `master` with explicit seed-Job lifecycle.
- Drizzle migrations committed; CI data-quality applies them via drizzle-kit
  with psql fallback; ARCHITECTURE 15.1 records schema.ts as source of truth.
- Rate-review snapshot (`config/rate-snapshot.json`) carries the current
  official table (WS1.7).
- Small-brewery relief not seeded; documented as UNAVAILABLE with rationale
  (WS1.4 option B). `DEFAULT_RATES` all zero with ESTIMATED reliability
  (WS1.6, no-wrong-fallback option).
- GDPR erasure implemented against the repository with audit event;
  AccountService constructor fails fast outside tests (WS4).
- `AuditService.logChange` wired into rate-review, classification rule-set
  publication, ranking config changes, account anonymization (WS5.1).
- `transportArrangement` on CalculatorInput; `PERSONAL` reaches the classifier
  (WS5.4); e2e covers TravellerImport.
- Idempotency hash includes dataset versions plus lookup-time invalidation
  (WS5.5).
- Ranking methodology lockstep tests (WS5.7); AgeGateGuard on calculator,
  search, ranking, declaration controllers with a coverage test (WS5.8);
  CorrectionFlagPanel in the frontend (WS5.9).
- Frontend pages present: calculator, result/explanation, compare, ranking
  methodology, account, age gate.

## Findings

### N1. CRITICAL (HEAD). Production DI composition binds the calculator and excise engine to null ports

- `packages/core-domain/src/calculator/calculator.module.ts` (HEAD): static
  module provides `PRODUCT_DATA_PORT` and `CALCULATION_RECORD_PORT` as
  `useValue: null` inside its own scope.
- `packages/core-domain/src/tax/tax.module.ts` (HEAD): same pattern for
  `TAX_RULE_REPOSITORY_PORT`.
- `apps/backend/src/app.module.ts` (HEAD): the real adapters
  (`ProductDataAdapter`, `CalculationRecordAdapter`) are registered in the root
  module. NestJS resolves dependencies within a module's own closure, so
  `LandedCostCalculatorService` and `AlcoholExciseService` see the null
  bindings, not the adapters. `DataPlatformModule`'s real
  `TAX_RULE_REPOSITORY_PORT` binding likewise never reaches the service inside
  `TaxModule`.
- No test boots the real `AppModule`. The e2e suite builds its own
  TestingModule and `overrideProvider`s every port, so the broken composition
  is invisible to CI.
- `diag-tmp.mjs` at the repo root is a live diagnosis of exactly this problem,
  and the uncommitted working tree is a `forRoot` refactor fixing it. That
  refactor is unfinished (see N4).

Consequence: any calculation request through the deployed backend throws
(TypeError on a null port) before any domain logic runs. Phase 1's core user
journey does not work in the composed system.

### N2. CRITICAL (HEAD). Excise taxType vocabulary split: engine reads `excise`, every seed writes `excise_duty`

- Engine: `packages/core-domain/src/tax/services/alcohol-excise.service.ts:86`
  calls `findAllApplicable('excise', ...)`. Container duty is consistent
  (`'container_duty'` on both sides); only excise is split.
- Seeds at HEAD: 26 excise rows in `tax-rules.seed.ts` plus both staging
  placeholders use `taxType: 'excise_duty'`.
- No translation layer exists anywhere between the service call and the Drizzle
  query (`eq(taxRules.taxType, taxType)`).
- Test fixtures seed `taxType: 'excise'`
  (`tests/golden/helpers/in-memory-tax-rule.repository.ts`, comment: "The
  taxType values here match what the services query"), so golden, unit, and e2e
  suites all pass against a vocabulary the real database never uses.
- Fallback behavior makes the failure silent in the other direction:
  `DEFAULT_RATES` are all zero with ESTIMATED reliability, so a real-DB lookup
  that matches nothing returns excise 0.00 EUR, flagged only as an estimate.

The uncommitted working tree renames the seed side to `'excise'` (seed rows,
both staging placeholders) but leaves the doc comments in
`schema.ts:98`, `repository-registry.interface.ts`, and
`tax-rule-query.service.ts` saying `"excise_duty"`, and any database already
seeded with `'excise_duty'` rows keeps serving invisible rows after the rename
(the seed's skip logic matches on `versionLabel`, so it will not re-insert or
fix existing rows).

### N3. HIGH (HEAD). Deploy pipelines apply no schema and seed no official data

- `deploy-staging.yml` and `deploy-production.yml` build/push the image and
  apply kustomize overlays. No step, Job, or initContainer runs the Drizzle
  migrations against the target database. A fresh staging or production
  database has no tables; the seed Job and the backend both fail.
- The staging seed Job runs `seed-runner.js`, which calls
  `seedStagingDatabase` only. At HEAD that seeds the v9999-staging
  placeholders (beer 9.99, wine 1.23, container 0.10) and nothing else.
  `seedTaxRules`/`SEED_RULES` (the corrected official dataset) have no caller
  anywhere: they exist only as code plus comments referencing them. Production
  has no seed path at all, which is correct for fake merchants but means the
  official tax dataset is currently unreachable in every environment.
- T0.5's intent ("staging carries its own copy of the tax-rule dataset for
  realistic legal review") is therefore not met at HEAD: staging tax rules are
  the fake placeholders. The uncommitted working tree starts fixing this
  (staging seed includes `SEED_RULES`) but contradicts
  `docs/staging-verification.md` section 4, which asserts staging must contain
  only `v9999-staging` labels.

### N4. HIGH (repo state). Uncommitted, half-finished refactor; working tree mutated during this audit

- 11 modified files + 3 untracked files sit on top of PR #18's head: the
  `ApplicationApiModule.forRoot` / `CoreDomainModule.forRoot` /
  `CalculatorModule.forRoot` / `TaxModule.forRoot` rework (the N1 fix), the
  excise rename (the N2 fix), staging seed including the official dataset, an
  extracted `effective-range-validator.ts`, a banded seed self-check,
  `scripts/dev-up.sh`, and `diag-tmp.mjs` (a scratch file at the repo root,
  which also violates the repo's scratch-file rule).
- `pnpm-workspace.yaml` adds `nodeLinker: hoisted` +
  `resolvePeersFromWorkspaceRoot: true`. The local node_modules was reinstalled
  under that layout, and the e2e suite now fails locally for BOTH HEAD and the
  working tree (`RateLimitingGuard2` cannot resolve `Reflector`), while CI on
  the same commit is green. The hoisted layout defeats the single-instance
  `@nestjs/core` aliasing the e2e config relies on.
- During this audit the working tree changed under me: the seed self-check
  gained band grouping between two runs minutes apart, turning a failing
  data-platform suite green with no action from this session. Another session
  or editor is active on these files. Coordinate before anyone lands or
  discards this work.
- `package.json` description now contains a literal `\u2014` escape (minor).

### N5. MEDIUM. Stale legacy SQL dataset still loaded by CI data-quality, dead env var in ci.yml

- `infra/staging-data/seed.sql` still encodes the pre-round-1 wrong rates
  (beer 33.00, spirits 2950.00, wine 340.00, sparkling 373.00, formula
  `PER_DEGREE_PLATO`, version label `2024-01`). The CI data-quality job loads
  exactly this file into its Postgres service and validates schema conformance
  against it. The golden CI job sets `GOLDEN_DATASET_PATH=./infra/staging-data`
  but `scripts/test-golden-dataset.sh` never reads that variable (dead env).
  Nothing rate-critical depends on it today, but it is a second, wrong "truth"
  sitting next to the corrected dataset, and it is the only real-Postgres seed
  in CI.

### N6. MEDIUM. T1.73 load/performance testing remains open

- Only the in-process Vitest benchmark exists (`tests/load/`). No HTTP-level
  load test against the landed-cost endpoint (implementation plan section 12;
  round-1 plan 1B). `docs/tasks.md` honestly leaves T1.73 unchecked and
  `docs/staging-verification.md` documents HTTP-level testing as not
  implemented. The unused `artillery` devDependency was removed, so nothing is
  half-wired; it simply is not built.

### N7. LOW. Residual reliability-vocabulary bridge

- `landed-cost-calculator.service.ts:133` still maps transport
  `EXACT` to `VERIFIED` ad hoc, and the transport result type still uses
  `'EXACT' | 'ESTIMATED'`. Result typing is the canonical union (round-1 M3
  partially applied). Collapse the producer side or document the accepted
  bridge.

### N8. LOW. Doc drift

- `schema.ts`, `repository-registry.interface.ts`, `tax-rule-query.service.ts`
  still document `"excise_duty"` as the discriminator (ties into N2).
- `docs/staging-verification.md` sections 3b/4 conflict with the new staging
  seed direction (ties into N3).
- `docs/tasks.md` marks T0.4/T0.6 complete; accurate for CI itself, but the
  migration-step gap (N3) belongs in the debt list until closed.

---

## Fix plan

Order: WS-A and WS-B first (they gate each other: both touch the seed and the
module graph, and PR #18 must not merge before them). Then WS-C, then WS-D/WS-E
in parallel. Nothing here touches T1.65–T1.69.

### WS-A. Land the composition fix (N1, N4) — blocking, medium

1. Finish and review the `forRoot` refactor already in the working tree
   (`ApplicationApiModule.forRoot` threading `CalculatorPorts` +
   `TaxModuleOptions` into `CalculatorModule.forRoot`/`TaxModule.forRoot` with
   fresh undecorated module identities). Keep the static modules null-bound for
   tests only; make the backend composition root the only place that configures
   real ports.
2. Root-cause the working-tree e2e failure (`RateLimitingModule2` double
   registration): the configured module list imports `RateLimitingModule` while
   the e2e test imports it too; ensure one identity per module in the graph and
   that guards resolve `Reflector` from the pinned `@nestjs/core`.
3. Resolve the pnpm linker conflict: either revert `nodeLinker: hoisted` and
   keep the lockfile dedupe from `a8f353b`, or commit the linker change together
   with a regenerated lockfile and a green local `pnpm install --frozen-lockfile
   && pnpm test:e2e`. Do not leave the tree where local runs disagree with CI.
4. Add a **composition-root smoke test** to CI (new e2e describe block or a
   small `apps/backend/tests/composition` suite): boot the real `AppModule`
   with only the database connection faked, then assert via `ModuleRef` that
   `LandedCostCalculatorService` holds non-null `PRODUCT_DATA_PORT`,
   `CALCULATION_RECORD_PORT`, and that `AlcoholExciseService` holds the
   `TaxRuleRepositoryAdapter`, and that one real calculate() call completes.
   This test class would have caught N1 and must run in CI before PR #18 merges.
5. Hygiene: delete `diag-tmp.mjs` (or move under `.opencode/.tmp/`), fix the
   `package.json` description escape, and land or shelve the working tree with a
   commit message describing the N1/N2 fix.

Acceptance: `pnpm test:e2e` green locally from a clean install and in CI,
including the new composition test; no null-port bindings reachable from the
backend module graph; working tree committed or reverted with the branch green.

### WS-B. Close the excise vocabulary split (N2, N8) — blocking, small but broad

1. Finish the rename to a single constant: export `TAX_TYPES` (or a
   `TaxType` union) from core-domain; use it in the engine call site, the seed,
   the staging placeholders, and the golden/e2e fixtures. Update the doc
   comments in `schema.ts`, `repository-registry.interface.ts`, and
   `tax-rule-query.service.ts`.
2. Write a data migration for already-seeded databases
   (`UPDATE tax_rules SET tax_type = 'excise' WHERE tax_type = 'excise_duty'`)
   as a committed Drizzle migration, since the seed's versionLabel skip logic
   will not repair existing staging rows.
3. Add one **real-stack integration test**: apply Drizzle migrations to a
   throwaway Postgres, run `seedTaxRules`, then calculate through
   `AlcoholExciseService` backed by the real `DrizzleTaxRateRepository`; assert
   the official values (2024 beer 5 % 0.5 l = 91 snt; 2026 wine 1.2–2.8 band on
   both sides of 1.4.2026; spirits 2026 = 56.28 snt/cl above 10 %). This kills
   the fixture-consensus masking class permanently: it is the only test where
   the engine vocabulary and the seed vocabulary must agree through the real
   query path.

Acceptance: `grep` finds no `'excise_duty'` outside migration history; the
integration test runs in CI (extend the data-quality or golden job's Postgres);
staging DB after redeploy serves real excise values.

### WS-C. Migration and seed steps in deploys (N3) — high, medium

1. Add a migrate step to `deploy-staging.yml` and `deploy-production.yml`
   before the seed Job / rollout: a short-lived Job (same image) running
   `drizzle-kit migrate` (or applying the generated SQL via psql) against the
   target `DATABASE_URL`. Sequence per deploy: migrate, then seed (staging),
   then rollout.
2. Wire the official dataset into the staging seed (the working tree's
   `SEED_RULES` inclusion) and keep production seeding empty of merchants while
   still applying migrations.
3. Bring `deploy-production.yml` env/secret handling up to the staging
   workflow's level (round-1 L3 remainder).
4. GitHub settings (manual): require the `CI passed` check on `master` PRs.

Acceptance: a fresh database (empty Postgres) deployed via the staging workflow
ends with schema present, v1.0-2024 through v3.0-2026 rows, and a healthy
backend; production deploy runs migrations without seeding fake data.

### WS-D. Staging truth and docs (N3/T0.5, N5, N8) — medium, small

1. Decide the staging dataset policy: official versions plus clearly marked
   placeholders (the direction the working tree takes). Then update
   `docs/staging-verification.md` 3b/4: the isolation check becomes "no
   production merchant data and no non-staging merchant labels", and the
   expected tax labels include v1.0-2024 … v3.0-2026.
2. Regenerate `infra/staging-data/seed.sql` from `SEED_RULES` (small export
   script) or delete it and point `scripts/test-data-quality.sh` at a generated
   fixture; remove the dead `GOLDEN_DATASET_PATH` from `ci.yml`.
3. `docs/tasks.md`: annotate T0.4 with the WS-C migration-step closure once
   landed; keep T1.73 unchecked until WS-E.
4. M7/N7: either make the transport estimator emit the canonical
   `ReliabilityStatus` or record the EXACT-to-VERIFIED bridge as accepted debt
   in ARCHITECTURE 15.

### WS-E. HTTP-level load test, T1.73 (N6) — medium, medium

1. Add `artillery` (or a small k6 script) targeting
   `POST /api/v1/calculator/...`: ramp 1 to 50 concurrent over 60 s, steady 120
   s, payloads beer/spirits/basket; assert p95 < 2 s, error rate < 1 %, zero
   429s from the limiter in the steady window.
2. Wire it into `deploy-staging.yml` as the post-deploy step (replacing or
   extending the current in-process `pnpm test:load`), non-blocking first,
   blocking after a baseline exists.
3. Document the command in `docs/staging-verification.md` section 5 and check
   T1.73.

### WS-F. Process guardrails (N4) — small

1. One owner for the working tree: whoever is mid-refactor commits or shelves
   it; no parallel sessions editing the same files (observed during this audit).
2. Scratch files live under `.opencode/.tmp/`, never the repo root.
3. Re-run this audit's checks (CI green + composition test + vocabulary grep)
   before merging PR #18; update `docs/phase-0-1-verification-fix-plan.md` with
   a round-2 addendum pointing here.

## Sequencing and size

| Order | Workstream | Size | Blocks |
|---|---|---|---|
| 1 (parallel) | WS-A composition fix, WS-B vocabulary unification | M / S–M | PR #18 merge, every runtime claim |
| 2 | WS-C deploy migrations + official seed wiring | M | staging realism (T0.5), fresh-DB deploys |
| 3 (parallel) | WS-D docs/staging truth, WS-E load test | S / M | T1.73, accurate records |
| 4 | WS-F process | S | clean handoff |

## Out of scope

T1.65–T1.69 remain manual legal/owner tasks per `docs/legal-tasks-guide.md`.
WS-B's corrected dataset versions should flow through the pending-review
publish flow so the T1.66 sign-off covers them, as in round 1.

## Evidence index

- `packages/core-domain/src/calculator/calculator.module.ts` (HEAD): null port providers
- `packages/core-domain/src/tax/tax.module.ts` (HEAD): null tax repository provider
- `apps/backend/src/app.module.ts` (HEAD): adapters registered out of scope
- `packages/core-domain/src/tax/services/alcohol-excise.service.ts:86`: queries `'excise'`
- `packages/data-platform/src/seed/tax-rules.seed.ts` (HEAD): 26 rows `'excise_duty'`, no importer of `SEED_RULES`
- `packages/data-platform/src/seed/seed-runner.ts`: staging placeholders only
- `infra/staging-data/seed.sql`: legacy wrong rates, loaded by CI data-quality
- `.github/workflows/deploy-*.yml`: no migration step
- `diag-tmp.mjs`, uncommitted diff, local e2e failure vs green CI on `a8f353b`
- vero.fi alcohol excise table (11.6.2026 version), fetched 2026-08-21

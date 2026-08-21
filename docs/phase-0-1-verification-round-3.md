# Phase 0 + Phase 1 Verification, Round 3 — Post-Fix Re-Audit

> Audit date: 2026-08-21 (late evening session)
> Scope: Phase 0 and Phase 1 against `docs/rajahinta-fi-implementation-plan.md`
> and `docs/tasks.md`, excluding manual legal tasks T1.65–T1.69
> (`docs/legal-tasks-guide.md`).
> Baseline audited: `feature/phase0-1-runtime-composition-fix` at `1e58864`
> (PR #20, 21 commits), working tree clean apart from one untracked scratch
> file. Master is still at PR #19 (pre-fix).

## Verdict

**Phase 0 and Phase 1 are now correctly implemented at the code level. All
round-2 critical findings (N1 null-port DI, N2 excise vocabulary split, N3
missing deploy migrations) are fixed and independently verified. What remains
open is delivery and cleanup: the fix branch is unmerged and blocked on a
required review, the staging deploy workflow fails on a missing registry
secret (so staging has never had a successful deploy), and a legacy placeholder
pipeline (`deploy.yml`) overlaps the real deploy workflows.**

None of the remaining items are code defects in the calculation path. Every
test layer this repo owns is green, locally and in CI, including the two test
classes added to catch the round-2 defect types.

## Verification method

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (0 errors, 54 pre-existing warnings) |
| `pnpm test` (all workspaces) | pass |
| `pnpm test:e2e` | pass 17/17, 0 skipped |
| `pnpm test:golden` | pass 30/30 |
| Composition smoke (`apps/backend/tests/composition`) | pass 5/5 locally |
| Real-stack integration vs fresh Postgres 16 (Docker, port 5433) | pass 6/6; migrations applied, 86 official rules seeded, range validation reports no gaps/overlaps |
| CI on PR #20 head `1e58864` | all checks pass (lint, content-policy, build, unit, golden, data-quality, compliance, e2e, composition-smoke, integration, ci-pass, load) |
| `grep excise_duty` | matches only in migration `0001_tax_type_migration.sql`, audit docs, and one stale comment in deprecated `infra/staging-data/schema.sql` |
| GitHub state | PR #20 open, mergeable, `mergeStateStatus: BLOCKED` (required review, none present); branch protection on `master` requires `CI / ci-pass` + 1 approving review |
| Deploy Staging runs on `master` | 2 runs, both **failure** at "Log in to GitHub Container Registry" (`secrets.REGISTRY_TOKEN` missing or invalid) |

## Round-2 findings: closed and verified

- **N1 (null-port DI).** `CalculatorModule.forRoot` / `TaxModule.forRoot` /
  `CoreDomainModule.forRoot` / `ApplicationApiModule.forRoot` return fresh
  undecorated module identities carrying the real port providers inside the
  consuming module's scope. `AppModule` wires `ProductDataAdapter` and
  `CalculationRecordAdapter` through `ApplicationApiModule.forRoot`. The
  composition smoke test boots the real `AppModule` and asserts non-null ports
  plus one end-to-end `calculate()`. Verified locally and as a required CI job.
- **N2 (excise vocabulary).** Single `TAX_TYPES` / `TaxType` vocabulary
  exported from core-domain; engine, seed, staging placeholders, and fixtures
  all consume it. Committed Drizzle data migration `0001` normalises legacy
  rows. The real-stack integration test (migrations + `seedTaxRules` +
  `DrizzleTaxRateRepository` + `AlcoholExciseService`) asserts official values
  through the real query path; reproduced locally against a fresh Postgres.
- **N3 (deploy migrations/seed).** Both deploy workflows sequence a
  `rajahinta-migrate` Job (drizzle-kit with psql fallback) before seed/rollout,
  with explicit create/wait/fail-with-logs. Staging seed includes `SEED_RULES`
  (86 official rows) alongside the three v9999 placeholders, guarded by
  `seed-composition.test.ts`. Production seeds no merchants.
- **N4 (repo hygiene).** Working tree is committed; `nodeLinker: hoisted`
  reverted to the isolated linker; no scratch files at the repo root
  (`diag-tmp.mjs` gone).
- **N5 (legacy SQL).** `infra/staging-data/seed.sql` regenerated from
  `SEED_RULES` via `scripts/export-seed-sql.mjs`; CI data-quality applies
  Drizzle migrations and generates its fixture at runtime; dead
  `GOLDEN_DATASET_PATH` env removed from both workflows.
- **N6 (HTTP load test).** Artillery suite exists
  (`tests/load/artillery/calculator-suite.yml` + `steady-429-check.yml`,
  `pnpm load:http`) and runs as a post-deploy step in `deploy-staging.yml`
  (non-blocking until a baseline exists, per design D5).
- **N7 (EXACT→VERIFIED bridge).** `TransportEstimationService` emits canonical
  `ReliabilityStatus`; the ad-hoc bridge in the landed-cost calculator is
  deleted. `BasketShippingResult.reliability` keeps a basket-local
  `EXACT|ESTIMATED|PARTIAL` signal, recorded as accepted in ARCHITECTURE §15.
- **N8 (doc drift).** `schema.ts`, `repository-registry.interface.ts`,
  `tax-rule-query.service.ts` doc comments corrected;
  `docs/staging-verification.md` reflects official-plus-placeholder staging
  truth; tasks.md T0.4 carries the migration-step annotation.

Also re-confirmed from earlier rounds: `DEFAULT_RATES` all zero with ESTIMATED
reliability (no wrong fallback); small-brewery relief documented UNAVAILABLE;
rate-review snapshot carries the current official table; branch protection
requires the `ci-pass` aggregate check.

## Findings

### R3-1. HIGH (delivery). Staging has never been successfully deployed — registry credential failure

Both `deploy-staging.yml` runs on `master` (after PR #18 and PR #19) fail at
"Log in to GitHub Container Registry", which uses `secrets.REGISTRY_TOKEN`.
That secret is missing or invalid, so the pipeline cannot push images. Until
this is fixed, none of the following can be verified live: T0.4 (three-tier
pipeline, checked with a note that live verification is pending), T0.5's live
staging dataset, the migrate/seed Jobs against the real cluster, the artillery
HTTP baseline (T1.73), and any staging QA.

### R3-2. MEDIUM. Legacy `deploy.yml` placeholder pipeline overlaps the real deploy workflows

`.github/workflows/deploy.yml` predates the real pipelines and still runs:

- Its staging job triggers on every PR to `master` and produces the check
  named "Staging deploy (pull_request)" — which does not deploy anything: the
  deploy step is `echo "Deploying staging-<sha>"`, the smoke test curls
  `https://staging.rajahinta.fi/health` with `continue-on-error: true`, and no
  migrations or seeds run.
- Its production job's "Run database migrations" step is an echo with the real
  command commented out (`# pnpm run db:migrate:prod`), and its deploy step is
  another echo. It builds and pushes images tagged `:latest` under
  `ghcr.io/siimliimand/rajahinta-fi` — a different image path from the real
  `ghcr.io/rajahinta/rajahinta`, so no overwrite, but two "production image"
  sources of truth.
- Its build job runs `pnpm run lint` with `continue-on-error: true` and the
  comment "no ESLint config exists yet" — stale and false; lint is real and
  enforced in `ci.yml`.
- Header comments say "PR to main" / "PRs to `main`" while triggers target
  `master`.

This is the same duplicated-infrastructure drift class the round-1 audit
flagged for `seed.sql`. Delete the file (the real set is `ci.yml`,
`deploy-staging.yml`, `deploy-production.yml`, `load-tests.yml`) or strip it
down to only the dev-deploy job if that path is wanted for feature branches.

### R3-3. MEDIUM (process). The entire round-2 fix is unmerged and blocked on review

Branch protection on `master` requires one approving review; PR #20 has zero
reviews and its author cannot self-approve. Until PR #20 merges, `master`
still carries the N1/N2/N3 defects and every "fixed" claim holds only on the
feature branch. After merge, the `phase0-1-runtime-composition-fix` OpenSpec
change (tasks 17/17 complete) needs archiving per the repo workflow.

### R3-4. LOW. `infra/staging-data/schema.sql` outlived its deletion clause

ARCHITECTURE §15.1 says `schema.sql` "is deleted once the migration path is
wired into the staging deploy pipeline". The migrate Job is now wired, so the
deletion is due. The file also still carries a comment documenting
`"excise_duty"` as the discriminator, which is exactly the vocabulary drift
round 2 removed everywhere else. `setup.sh` and the README retain references
that should follow the same decision (setup.sh is a manual utility, but its
stale narrative should not contradict §15.1).

### R3-5. LOW. Residual doc drift

- ARCHITECTURE §15 still lists "HTTP-level load testing not implemented …
  artillery sits unused in devDependencies" — stale; the suite exists and is
  wired as the non-blocking post-deploy step.
- `docs/tasks.md` T1.72 note says "vocabulary lint not yet implemented" —
  stale; `content-lint.service.ts` (ingestion-side) and the frontend
  content-policy CI job exist and pass.
- `load-tests.yml` header says "on every PR to `main`"; the trigger is
  `master`.

### R3-6. LOW. Scratch file in `.opencode/`

`.opencode/opencode-onboard copy.json` is untracked and sits outside
`.opencode/.tmp/`. Delete it or move it under the tmp directory per the repo's
scratch-file rule.

### R3-7. LOW. Seed skip-granularity is per version label

`seedTaxRules` skips insertion per `versionLabel`: if rows within an already
present label are ever corrected without bumping the label, seeded databases
keep the old rows. This is the exact trap that forced the round-2 data
migration. The single-statement insert is atomic so partial versions cannot
occur from a failed run; the residual risk is future same-label corrections.
A per-version row-count (or hash) check that logs or fails on mismatch would
close it.

### R3-8. INFO. Known debts that remain open by design (recorded, acceptable)

- GDPR integration tests in `application-api` skip unless `TEST_DATABASE_URL`
  is set; the CI unit job does not set it (the CI integration job covers the
  excise stack only).
- Idempotency cache key is version-blind with lookup-time version comparison
  as defence in depth (ARCHITECTURE §15, task 5.5 follow-up).
- In-memory rate-limiting, idempotency, and audit repositories (pre-production
  migration to Redis/PostgreSQL documented).
- T1.56/T1.57 billing integration deferred to Phase 2 by decision.
- T1.73 unchecked pending the first successful staging run (correct per D5,
  and currently also blocked by R3-1).

## Fix plan

Order: FS-1 first (it gates the live verification of everything else), FS-2
and FS-3 immediately after (they gate the merge), then FS-4/FS-5 in parallel.
Nothing here touches T1.65–T1.69.

### FS-1. Make the staging deploy actually reach the cluster (R3-1) — small

1. Decide the registry credential: either create/rotate the `REGISTRY_TOKEN`
   secret (a PAT with `write:packages` for `ghcr.io/rajahinta/rajahinta`), or
   switch the login step to the workflow-scoped `secrets.GITHUB_TOKEN` with
   `permissions: packages: write` and confirm the `rajahinta/rajahinta`
   package allows the repo to push. GITHUB_TOKEN is preferable: no rotation,
   no second secret to lose.
2. After merging PR #20 (FS-3), push to `master` and require the Deploy
   Staging run to go green end to end: image push, migrate Job complete, seed
   Job complete, rollout healthy.
3. Walk `docs/staging-verification.md` top to bottom against the live
   environment (products, 86 official + 3 v9999 tax rules, transport offers,
   retail offers, isolation, load tests). Record the pass in the doc's
   checklist.
4. On that first green run, promote the artillery step from
   `continue-on-error: true` to blocking (D5 says non-blocking only until a
   baseline exists), then check T1.73 in `docs/tasks.md`.

Acceptance: at least one green Deploy Staging run on `master`; the staging
calculator resolves against `v3.0-2026`; T0.4/T0.5 live-verification notes
updated; T1.73 checked.

### FS-2. Delete the legacy `deploy.yml` (R3-2) — small

1. Delete `.github/workflows/deploy.yml`. The dev-compose smoke it provided
   for feature branches, if still wanted, is better expressed as a job in
   `ci.yml` (or a minimal `dev-check.yml` without the placeholder
   staging/production jobs).
2. Confirm no required check references its job names ("Staging deploy
   (pull_request)" is not in the branch-protection required list; verify after
   deletion that open PRs report no missing checks).
3. If any external habit depends on the `staging-latest` image tags it
   pushed, note the retirement in the PR description.

Acceptance: PRs to `master` no longer produce a "Staging deploy" check that
deploys nothing; `gh run list --workflow=deploy.yml` is empty going forward.

### FS-3. Merge and archive the round-2 fix (R3-3) — process

1. Review PR #20 (all 21 commits; CI green at head). Approve and merge to
   `master`. Given `enforce_admins` is disabled the owner may merge directly,
   but a real review is preferred for a change touching the composition root.
2. After merge, run the archive flow for the
   `phase0-1-runtime-composition-fix` OpenSpec change (17/17 tasks done) and
   update `docs/tasks.md` if any note references the pending merge.
3. Re-run this audit's spot checks on `master` post-merge: `ci-pass` green,
   Deploy Staging outcome (FS-1), `grep excise_duty` clean outside migration
   history.

Acceptance: `master` contains the composition/vocabulary/deploy fixes; the
OpenSpec change is archived; no verification claims depend on a feature
branch.

### FS-4. Retire `infra/staging-data/schema.sql` and fix stale docs (R3-4, R3-5) — small

1. Delete `infra/staging-data/schema.sql`; update `infra/staging-data/README.md`
   and `setup.sh` so they describe only the Drizzle-migration path plus
   `seed.sql` (generated). Remove the `excise_duty` comment along with the
   file.
2. ARCHITECTURE §15: replace the "HTTP-level load testing not implemented"
   entry with the current state (suite exists, wired non-blocking, blocking
   after first baseline per FS-1.4).
3. `docs/tasks.md` T1.72 note: drop "vocabulary lint not yet implemented";
   state where the vocabulary checks live (`content-lint.service.ts`,
   frontend content-policy job).
4. `load-tests.yml` header: `main` → `master`.

Acceptance: no stale-vocabulary or stale-tooling statements remain in docs or
comments; `infra/staging-data` contains only generated `seed.sql`, the README,
`staging-reviews.sql` (if still used by setup.sh), and `setup.sh`.

### FS-5. Hygiene and seed robustness (R3-6, R3-7) — small

1. Delete or relocate `.opencode/opencode-onboard copy.json` (scratch files
   belong under `.opencode/.tmp/`).
2. In `seedTaxRules`, after the skip computation, compare the count of
   already-present rows per version label against `SEED_RULES` and log a
   warning (or fail in strict mode) on mismatch, so a same-label correction is
   detected instead of silently skipped. Guarded by a unit test with a
   partially populated version.

Acceptance: working tree clean of stray files; the seed mismatch case is
tested.

## Sequencing and size

| Order | Workstream | Size | Blocks |
|---|---|---|---|
| 1 | FS-3 merge + archive | S | everything on `master` |
| 2 | FS-1 registry credential + live staging walk | S | T0.4/T0.5 live notes, T1.73, artillery baseline |
| 3 (parallel) | FS-2 delete deploy.yml, FS-4 doc/schema.sql cleanup | S / S | accurate records |
| 4 | FS-5 hygiene + seed check | S | robustness |

## Out of scope

T1.65–T1.69 remain manual legal/owner tasks per `docs/legal-tasks-guide.md`;
the technical launch gates stay closed exactly as designed. Commercial launch
conditions (user testing, willingness-to-pay) are likewise owner tasks.

## Evidence index

- PR #20 checks (all green at `1e58864`), including Composition smoke and
  Integration jobs
- Local runs: typecheck, lint, unit suites, e2e 17/17, golden 30/30,
  composition 5/5, integration 6/6 against `postgres:16` on port 5433
  (container removed after the run)
- `packages/core-domain/src/calculator/calculator.module.ts`,
  `packages/core-domain/src/tax/tax.module.ts`,
  `apps/backend/src/app.module.ts` — forRoot composition
- `packages/data-platform/drizzle/0001_tax_type_migration.sql` — vocabulary
  data migration
- `tests/integration/excise-engine.test.ts` — real-stack test; seeds 86 rules,
  validates ranges
- `.github/workflows/deploy-staging.yml`, `deploy-production.yml` — migrate
  Job sequencing; `deploy.yml` — placeholder pipeline slated for deletion
- Deploy Staging failures on `master`: runs `32507504778`, `32505681313`,
  failed step "Log in to GitHub Container Registry"
- Branch protection: required `CI / ci-pass` + 1 approving review; PR #20
  reviews: none
- `ARCHITECTURE.md` §15 (debt list, §15.1 schema decision),
  `infra/staging-data/README.md`, `scripts/export-seed-sql.mjs`
- `packages/data-platform/src/seed/tax-rules.seed.ts` — versionLabel skip
  logic (R3-7)

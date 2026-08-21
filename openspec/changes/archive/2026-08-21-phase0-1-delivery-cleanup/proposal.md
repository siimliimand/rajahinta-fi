# Phase 0+1 Delivery & Cleanup

## Why

The round-3 verification audit (2026-08-21 late evening, `docs/phase-0-1-verification-round-3.md`) confirmed that all round-2 critical findings are fixed at the code level — PR #20 (composition root, taxType vocabulary, deploy migrations) is merged and its OpenSpec change archived, and every owned test layer is green locally and in CI. But the audit also found that the fixes have never reached a live environment, and that residual cleanup items remain:

- **R3-1 (high)** The `Deploy Staging` workflow has failed three times on `master` (runs 32505681313, 32507504778, 32517833413), each at the "Log in to GitHub Container Registry" step — the `REGISTRY_TOKEN` secret is missing or invalid. Staging has never had a successful deploy, so T0.4's live verification note, T0.5's live staging dataset, the migrate/seed Jobs against the real cluster, and the artillery HTTP baseline (T1.73) are all unverifiable until this is fixed.
- **R3-2 (medium)** `.github/workflows/deploy.yml` is a legacy placeholder pipeline overlapping the real deploy workflows: its staging "deploy" step is an `echo`, its production migration step has the real command commented out, its lint step bypasses with a stale "no ESLint config exists yet" comment, and it pushes a second, different `production image path. It produces a "Staging deploy" PR check that deploys nothing.
- **R3-4 (low)** `infra/staging-data/schema.sql` outlived its deletion clause — ARCHITECTURE §15.1 says it "is deleted once the migration path is wired into the staging deploy pipeline", which PR #20 did. It still carries an `excise_duty` vocabulary comment that round 2 removed everywhere else.
- **R3-5 (low)** Doc drift: ARCHITECTURE §15 still says HTTP load testing is not implemented and artillery is unused; `docs/tasks.md` T1.72 note says "vocabulary lint not yet implemented"; `load-tests.yml` header says "PR to `main`" while triggering on `master`.
- **R3-6/R3-7 (low)** A scratch file (`.opencode/opencode-onboard copy.json`) sits outside `.opencode/.tmp/`; and `seedTaxRules` skips per version label without checking row counts, so a same-label correction would silently leave stale rows in seeded databases — the exact trap that forced the round-2 data migration.

Out of scope: T1.65–T1.69 (manual legal/owner tasks per `docs/legal-tasks-guide.md`) and the R3-8 recorded debts that are open by design (in-memory cross-cutting stores, version-blind idempotency key with lookup-time defence, GDPR tests requiring `TEST_DATABASE_URL`).

## What Changes

- **Registry credential (R3-1)**: switch both deploy workflows' GHCR login to the workflow-scoped `secrets.GITHUB_TOKEN` with `permissions: packages: write` (preferred — no rotation, no second secret), keeping `REGISTRY_TOKEN` as fallback if the `ghcr.io/rajahinta/rajahinta` package ACL requires a PAT. After merge, require one green end-to-end Deploy Staging run on `master` (image push, migrate Job, seed Job, rollout), walk `docs/staging-verification.md` against the live environment, and record the pass.
- **Artillery promotion (T1.73)**: on the first green baseline, promote the HTTP load step in `deploy-staging.yml` from `continue-on-error: true` to blocking (design D5 of the round-2 change said non-blocking only until a baseline exists), then check T1.73 in `docs/tasks.md`.
- **Legacy pipeline removal (R3-2)**: delete `.github/workflows/deploy.yml`; relocate its dev-compose smoke for feature branches into `ci.yml` only if that path is still wanted; confirm no required-check references its job names.
- **schema.sql retirement (R3-4)**: delete `infra/staging-data/schema.sql` and align `infra/staging-data/README.md` + `setup.sh` with the Drizzle-migration-only path, removing the stale `excise_duty` comment with the file.
- **Doc truth (R3-5)**: update ARCHITECTURE §15 (load-testing entry), drop the stale T1.72 note in `docs/tasks.md`, fix the `load-tests.yml` header (`main` → `master`), and commit `docs/phase-0-1-verification-round-3.md` as the source document of this change.
- **Seed integrity (R3-7)**: after the skip computation in `seedTaxRules`, compare already-present row counts per version label against `SEED_RULES` and warn (or fail in strict mode) on mismatch, guarded by a unit test with a partially-populated version.
- **Hygiene (R3-6)**: delete the stray `.opencode/opencode-onboard copy.json`.

## Capabilities

### Modified Capabilities

- `ci-cd-pipeline`: deploy workflows authenticate to GHCR with a working credential; staging deploy completes end-to-end on `master`; no placeholder/echo deploy pipelines remain in `.github/workflows/`
- `load-testing`: the artillery post-deploy step becomes blocking once a baseline exists; T1.73 reflects reality
- `tax-duty-engine`: seed detects per-version row-count mismatches instead of silently skipping same-label corrections

No new capabilities.

## Impact

- **Code**: `packages/data-platform/src/seed/tax-rules.seed.ts` (row-count check), `packages/data-platform/src/seed/__tests__/` (new unit test).
- **Infrastructure**: `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-production.yml` (credential + permissions + artillery promotion), deletion of `.github/workflows/deploy.yml`, `infra/staging-data/schema.sql` deletion, `infra/staging-data/README.md` + `setup.sh` updates, `load-tests.yml` header fix.
- **Documentation**: `ARCHITECTURE.md` §15, `docs/tasks.md` (T1.72 note, T1.73 check, T0.4/T0.5 live-verification notes), `docs/staging-verification.md` (recorded live pass), new `docs/phase-0-1-verification-round-3.md` (already drafted in the working tree).
- **Data**: none — no schema or dataset changes; the seed check is read-only detection.
- **Dependencies**: none.

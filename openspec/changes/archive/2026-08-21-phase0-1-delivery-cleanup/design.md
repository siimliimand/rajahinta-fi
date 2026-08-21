# Phase 0+1 Delivery & Cleanup — Design

> Context: `docs/phase-0-1-verification-round-3.md` (round-3 audit). This
> change delivers already-merged code to a live staging environment and
> removes residual drift; it does not modify any calculation logic or tax
> values.

## D1. GHCR credential: workflow-scoped GITHUB_TOKEN first

**Problem.** Both `Deploy Staging` runs on `master` (and the third after PR
#20 merged) fail at "Log in to GitHub Container Registry", which uses
`secrets.REGISTRY_TOKEN`. The secret is missing or invalid, so images cannot
be pushed and the pipeline never reaches the migrate/seed/rollout steps.

**Decision.** Replace the PAT-based login with the workflow-scoped
`secrets.GITHUB_TOKEN`:

- add `permissions: contents: read, packages: write` to the deploy job (or
  workflow) in both `deploy-staging.yml` and `deploy-production.yml`;
- change the `docker/login-action` password from `${{ secrets.REGISTRY_TOKEN }}`
  to `${{ secrets.GITHUB_TOKEN }}`;
- keep the same `IMAGE_NAME` (`ghcr.io/rajahinta/rajahinta`).

GITHUB_TOKEN is preferred over re-creating a PAT: no rotation burden, no
second secret to lose, and scope is automatically limited to this repository.
The known caveat is package ACL: if `ghcr.io/rajahinta/rajahinta` was created
by a PAT under a different owner path, the repo's GITHUB_TOKEN may not have
push rights. The task therefore verifies the first push; if the ACL blocks it,
the fallback is a fine-grained PAT with `write:packages` stored as
`REGISTRY_TOKEN` and the login step reverted — the workflow shape stays
identical either way.

**Guard.** Task 1.2 requires one fully green `Deploy Staging` run on `master`
(image push, migrate Job complete, seed Job complete, rollout healthy) before
the live verification walk.

## D2. Delete the legacy `deploy.yml` outright

**Problem.** `.github/workflows/deploy.yml` predates the real pipelines and
still runs on every PR to `master`: its staging job echoes instead of
deploying, its production migration step is an echo with the real command
commented out, it pushes a second image path
(`ghcr.io/siimliimand/rajahinta-fi`), and it lint-bypasses with a stale
"no ESLint config exists yet" comment. It manufactures a "Staging deploy
(pull_request)" check that deploys nothing — the same duplicated-infrastructure
drift class round 1 flagged for `seed.sql`.

**Decision.** Delete the file. The real set is `ci.yml`, `deploy-staging.yml`,
`deploy-production.yml`, `load-tests.yml`. If the dev-compose smoke it
provided for feature-branch pushes is still wanted, add it as a job in
`ci.yml` (build + `docker compose up` + `/health` curl) rather than keeping a
second deploy-shaped workflow. Verification: after deletion, branch
protection must report no missing required checks (the required context
`CI / ci-pass` lives in `ci.yml`) and open PRs must not show a stuck check.

**Alternatives rejected.** (a) Fixing `deploy.yml` in place — two staging and
two production pipelines is exactly the drift being removed. (b) Disabling
triggers only — a dead file with deploy permissions still invites
copy-paste-reuse of its placeholder steps.

## D3. `schema.sql` retirement per the recorded decision

**Problem.** ARCHITECTURE §15.1 states `infra/staging-data/schema.sql` "is
deleted once the migration path is wired into the staging deploy pipeline".
PR #20 wired the migrate Job; the file remains and still documents
`"excise_duty"` as the discriminator — the vocabulary round 2 removed
everywhere else.

**Decision.** Delete `infra/staging-data/schema.sql`. Update
`infra/staging-data/README.md` and `setup.sh` so they describe only the
Drizzle-migration path plus the generated `seed.sql`
(`scripts/export-seed-sql.mjs` remains the generator). No deploy path
consumes `schema.sql` today (the migrate Job applies Drizzle migrations; CI
data-quality generates its fixture at runtime), so deletion is safe; the
decision record in §15.1 already covers it.

## D4. Artillery promotion after first baseline

**Problem.** The round-2 change wired `pnpm load:http` as a post-deploy step
with `continue-on-error: true`, deliberately non-blocking "until a baseline
exists" (its design D5). No baseline exists because no staging deploy has
ever succeeded (D1).

**Decision.** Once task 1.2 produces a green deploy plus a recorded baseline
run, remove `continue-on-error` from the HTTP load step so a threshold
breach (p95 ≥ 2 s, error rate ≥ 1 %, any 429 in the steady window) fails the
deploy. The in-process benchmark step may keep `continue-on-error` — it is
informational. Then check T1.73 in `docs/tasks.md` with a note pointing at
the baseline run URL.

## D5. Seed mismatch detection, warn by default

**Problem.** `seedTaxRules` skips insertion per `versionLabel`: rows within
an already-present label are assumed complete. The round-2 vocabulary split
showed why that is fragile — seeded databases kept invisible rows and needed
a committed data migration. A future same-label correction (e.g. someone
fixes a rate inside `v3.0-2026` without bumping the label) would silently
not deploy.

**Decision.** After computing `existingLabels`, also select per-label row
counts and compare against `SEED_RULES` counts. On mismatch, log a warning
naming the label and both counts; in strict mode (opt-in flag/env used by the
seed Job's staging path) fail the seed so the drift is caught at deploy time.
Default remains warn so dev databases with hand-trimmed rows do not break.
Add a unit test seeding a partially-populated version label and asserting
both the warning path and the strict failure. This is detection only — repair
still requires a labelled new version or a data migration by design
(append-only dataset policy).

## D6. Doc-truth sweep

One task fixes the three known stale statements (ARCHITECTURE §15
load-testing bullet, `docs/tasks.md` T1.72 "vocabulary lint not yet
implemented" note, `load-tests.yml` "PR to `main`" header) and commits the
round-3 report `docs/phase-0-1-verification-round-3.md` (already drafted,
currently untracked) as this change's source document. T0.4/T0.5 notes and
`docs/staging-verification.md` checklist updates follow the live walk in
task 1.2.

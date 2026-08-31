# ci-cd-pipeline Specification

## Purpose

Automated continuous integration and continuous deployment pipeline using GitHub Actions, ensuring that every code change passes lint, typecheck, unit tests, and golden-dataset regression tests before merging, and that staging deployments are automated.
## Requirements
### Requirement: CI runs on every PR and push

The CI pipeline SHALL run on every pull request to and every push to the repository's actual default branch (`master`), executing lint, typecheck, unit tests, and golden-dataset regression tests in a matrix environment matching production dependencies. Workflow triggers SHALL reference the default branch that exists in the repository — a trigger on a non-existent branch is a CI outage.

#### Scenario: PR receives CI feedback

- **WHEN** a pull request is opened or updated against `master`
- **THEN** the CI workflow SHALL run all checks and report pass/fail status

#### Scenario: Default branch protected

- **WHEN** a push lands on `master`
- **THEN** the CI workflow SHALL re-run all checks to guard against merge-race conditions

#### Scenario: Trigger matches reality

- **WHEN** the default branch is `master`
- **THEN** no required workflow SHALL declare triggers on a branch named `main`

### Requirement: CI matrix matches production stack

The CI environment SHALL use Node.js 22, PostgreSQL 16, and Redis 7 — matching the production stack version constraints defined in `docs/tech-stack.md`.

#### Scenario: Version mismatch caught

- **WHEN** a developer attempts to use a feature from a newer Node.js version
- **THEN** the CI SHALL fail, preventing the incompatible code from reaching production

### Requirement: Golden-dataset tests are non-skippable in CI

The golden-dataset regression tests SHALL be included in the CI workflow and SHALL NOT be skippable. A golden-dataset failure SHALL block merge.

#### Scenario: Golden test regression blocks merge

- **WHEN** a code change breaks a golden-dataset test
- **THEN** the CI SHALL report failure and the PR SHALL be blocked from merging

### Requirement: Staging deployment workflow

The staging deployment workflow SHALL authenticate to Cloudflare, apply D1 migrations to the staging database, run the D1 seed (where configured), and deploy the API Worker, email Worker, and frontend Worker via wrangler. A push to `master` SHALL produce a green end-to-end staging deploy on Cloudflare Workers (migrations applied, seed complete, all Workers healthy on their staging routes). The workflow SHALL NOT contain placeholder or echo-only deploy steps, and the K8s/kustomize deploy path SHALL NOT be used.

#### Scenario: Automated staging deploy

- **WHEN** a push to `master` triggers the staging deploy workflow
- **THEN** D1 migrations run against the staging database, seed completes, and all Workers deploy to the staging environment with healthy readiness endpoints

#### Scenario: No placeholder deploy pipelines

- **WHEN** the deploy workflows are inspected
- **THEN** no workflow contains echo-only "deploy" or "migration" steps; the deploy surface is exactly `ci.yml`, `deploy-staging.yml`, `deploy-production.yml`, and `load-tests.yml`
### Requirement: CI job completeness

The CI workflow SHALL include lint, typecheck, build, unit tests, golden-dataset regression tests, data-quality tests, compliance tests, content-policy checks, and end-to-end tests, unified under a single `ci-pass` gate job whose status reflects all of them. Removing a job from the workflow SHALL require an explicit spec change, not happen as workflow-file churn.

#### Scenario: Full job set runs on a PR

- **WHEN** a pull request is opened against the default branch
- **THEN** every job in the required set SHALL run and the `ci-pass` gate SHALL aggregate their results

#### Scenario: Job removal is detected

- **WHEN** the CI workflow no longer contains a required job (e.g. compliance)
- **THEN** the gap SHALL be treated as a CI regression and restored

### Requirement: Deploys run schema migrations before seed and rollout

Both the staging and production deploy workflows SHALL apply the committed D1 migrations (via `wrangler d1 migrations apply`) to the target database before any seed step or Worker rollout. Sequence per deploy: migrate → seed (staging only) → deploy. A deploy against a fresh, empty D1 database SHALL end with schema present, and on staging additionally with the official tax versions seeded.

#### Scenario: Fresh staging database

- **WHEN** staging deploys against an empty D1 database
- **THEN** schema exists after migrations, official tax versions are seeded, and the deployed Worker passes its readiness check
### Requirement: CI gates composition and vocabulary integrity

CI SHALL include the composition-root smoke test and the real-stack integration test as required checks aggregated into the `CI passed` gate, and SHALL not define dead environment variables. The repository SHALL require the `CI passed` check on `master` pull requests.

#### Scenario: Broken port wiring fails CI

- **WHEN** a change reintroduces null-port wiring or a seed/engine vocabulary split
- **THEN** the composition smoke test or the real-stack integration test SHALL fail, blocking merge

#### Scenario: No dead workflow configuration

- **WHEN** a workflow defines an environment variable consumed by a script
- **THEN** the script SHALL actually read it (the `GOLDEN_DATASET_PATH` precedent is removed)

### Requirement: Production deployment workflow

The production deployment workflow SHALL require a manual confirmation input, apply D1 migrations to the production database, and deploy all Workers via wrangler. The workflow SHALL NOT deploy from an unconfirmed trigger. The production deploy SHALL leave the previous Workers versions available for instant rollback (Workers rollback) independent of DNS.

#### Scenario: Confirmed production deploy

- **WHEN** the production workflow runs with confirmation set
- **THEN** migrations apply, all Workers deploy, and readiness checks pass on production routes

#### Scenario: Unconfirmed production deploy

- **WHEN** the production workflow runs without explicit confirmation
- **THEN** the workflow fails fast without deploying

### Requirement: EU data placement

The production and staging wrangler configurations SHALL place data-plane resources in the EU: D1 primary location, Durable Object location hint, and KV jurisdiction. The configuration SHALL be reviewable as committed config, not dashboard state.

#### Scenario: Placement review

- **WHEN** the wrangler configuration for staging or production is inspected
- **THEN** D1, DO, and KV resources declare EU placement

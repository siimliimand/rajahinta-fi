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

A deployment workflow SHALL exist that builds the Docker image, pushes it to a container registry, and applies the staging Kubernetes overlay. The workflow SHALL trigger on push to the repository's actual default branch (`master`) or via manual dispatch, and SHALL manage the staging seed Job explicitly: create (or apply) the Job, wait for completion, and tolerate re-runs.

#### Scenario: Automated staging deploy

- **WHEN** code is pushed to `master`
- **THEN** the staging deployment workflow SHALL build and deploy to the staging environment

#### Scenario: Seed job lifecycle is explicit

- **WHEN** the staging deploy applies the seed Job
- **THEN** the workflow SHALL wait for that Job's completion explicitly and SHALL NOT wait on a Job it never created

### Requirement: CI job completeness

The CI workflow SHALL include lint, typecheck, build, unit tests, golden-dataset regression tests, data-quality tests, compliance tests, content-policy checks, and end-to-end tests, unified under a single `ci-pass` gate job whose status reflects all of them. Removing a job from the workflow SHALL require an explicit spec change, not happen as workflow-file churn.

#### Scenario: Full job set runs on a PR

- **WHEN** a pull request is opened against the default branch
- **THEN** every job in the required set SHALL run and the `ci-pass` gate SHALL aggregate their results

#### Scenario: Job removal is detected

- **WHEN** the CI workflow no longer contains a required job (e.g. compliance)
- **THEN** the gap SHALL be treated as a CI regression and restored

### Requirement: Deploys run schema migrations before seed and rollout

Both the staging and production deploy workflows SHALL apply the committed Drizzle migrations to the target database (short-lived Job using the deployed image) before any seed Job or workload rollout. Sequence per deploy: migrate → seed (staging only) → rollout. A deploy against a fresh, empty database SHALL end with schema present, and on staging additionally the official tax versions seeded.

#### Scenario: Fresh-database staging deploy succeeds

- **WHEN** the staging deploy workflow runs against an empty PostgreSQL instance
- **THEN** migrations SHALL create the schema, the seed Job SHALL insert the official dataset rows, and the backend rollout SHALL become healthy

#### Scenario: Production applies migrations without seeding fake data

- **WHEN** the production deploy workflow runs
- **THEN** migrations SHALL be applied and no staging placeholder or fake merchant data SHALL be inserted

### Requirement: CI gates composition and vocabulary integrity

CI SHALL include the composition-root smoke test and the real-stack integration test as required checks aggregated into the `CI passed` gate, and SHALL not define dead environment variables. The repository SHALL require the `CI passed` check on `master` pull requests.

#### Scenario: Broken port wiring fails CI

- **WHEN** a change reintroduces null-port wiring or a seed/engine vocabulary split
- **THEN** the composition smoke test or the real-stack integration test SHALL fail, blocking merge

#### Scenario: No dead workflow configuration

- **WHEN** a workflow defines an environment variable consumed by a script
- **THEN** the script SHALL actually read it (the `GOLDEN_DATASET_PATH` precedent is removed)


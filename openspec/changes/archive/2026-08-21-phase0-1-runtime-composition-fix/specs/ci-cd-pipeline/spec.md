# ci-cd-pipeline — Delta Spec

## MODIFIED Requirements

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

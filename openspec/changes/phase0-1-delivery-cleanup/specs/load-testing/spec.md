# load-testing — Delta Spec

## MODIFIED Requirements

### Requirement: CI integration (non-blocking initially)

The HTTP artillery suite SHALL run as a post-deploy step of the staging deploy. It SHALL remain non-blocking (`continue-on-error`) only until a performance baseline from a successful staging deploy exists; once a baseline exists, the step SHALL be blocking so that a threshold breach fails the deploy. With the step promoted to blocking, `docs/tasks.md` T1.73 SHALL be checked with a reference to the baseline run.

#### Scenario: Post-deploy load check runs against staging

- **WHEN** a staging deploy completes successfully
- **THEN** the artillery suite SHALL execute against the deployed staging URL with the documented command (`pnpm load:http`)

#### Scenario: Promotion to blocking after baseline

- **WHEN** a green staging deploy has produced a recorded artillery baseline
- **THEN** the HTTP load step SHALL run without `continue-on-error`, and a threshold breach (p95 ≥ 2 s, error rate ≥ 1 %, or any 429 in the steady window) SHALL fail the deploy workflow

#### Scenario: T1.73 reflects reality

- **WHEN** the blocking promotion lands
- **THEN** `docs/tasks.md` T1.73 SHALL be checked and annotated with the baseline run reference

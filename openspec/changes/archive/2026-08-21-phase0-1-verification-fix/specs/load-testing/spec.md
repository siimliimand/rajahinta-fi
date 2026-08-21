# load-testing — Delta Spec

## MODIFIED Requirements

### Requirement: HTTP-level end-to-end measurement

The load-testing story SHALL consist of two explicitly labelled layers: (a) an in-process orchestrator benchmark that runs in CI without infrastructure, and (b) an HTTP-level load test that exercises the full endpoint against the staging environment after deployment, measuring the complete request-to-response path including middleware, rate limiting, and database access. Documentation SHALL describe commands that actually run — it SHALL NOT instruct users to execute a vitest suite through k6 or install k6 via npm.

#### Scenario: In-process benchmark labelled honestly

- **WHEN** CI or documentation runs the in-process load benchmark
- **THEN** it SHALL be identified as an orchestrator-level benchmark, distinct from HTTP-level load testing

#### Scenario: HTTP-level test against staging

- **WHEN** a staging deployment completes
- **THEN** an HTTP-level load test SHALL be executable against the staging URL, measuring network time, server processing, and middleware overhead

#### Scenario: Documentation matches reality

- **WHEN** a verification runbook instructs an operator to run a load test
- **THEN** every documented command SHALL execute successfully as written

### Requirement: CI integration (non-blocking initially)

The load test SHALL be runnable in CI against the staging environment after deployment. Initially it SHALL be non-blocking (informational only); it SHALL become blocking once the baseline is validated and any necessary optimizations are complete. The workflow SHALL either consume the staging URL it declares (running the HTTP-level test against it) or declare no such environment — it SHALL NOT define an unused staging URL while running only the in-process benchmark.

#### Scenario: CI runs load test after staging deploy

- **WHEN** a staging deployment completes
- **THEN** the load test SHALL be triggered against the staging URL and results SHALL be reported without blocking the deployment

#### Scenario: No phantom configuration

- **WHEN** the staging deploy workflow declares a `STAGING_URL` environment variable
- **THEN** a step in that workflow SHALL consume it; declared-but-unused environment variables and dependencies SHALL be removed

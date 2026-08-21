# load-testing Specification

## Purpose

Performance and load testing on the Landed-Cost Calculation endpoint — the highest-traffic, most computation-heavy path in the system with real unit-economics implications.
## Requirements
### Requirement: Load test script

A load test script SHALL exist that drives the Landed-Cost Calculation endpoint (`POST /api/v1/calculator`) with realistic payloads for the three alcohol categories (beer, wine, spirits) and a multi-item basket.

#### Scenario: Load test executes

- **WHEN** the load test script is executed against a running instance
- **THEN** it SHALL complete within a defined timeout and report per-endpoint latency and throughput metrics

### Requirement: Baseline thresholds

The load test SHALL define and assert against baseline thresholds: p95 latency < 2000ms, error rate < 1%, and zero rate-limit (429) responses during the test.

#### Scenario: Thresholds pass under normal load

- **WHEN** the load test runs at the defined concurrency level (1 to 50 users)
- **THEN** p95 latency SHALL be below 2000ms, error rate SHALL be below 1%, and no 429 responses SHALL appear

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

### Requirement: HTTP-level load test on the landed-cost endpoint

An HTTP-level load test suite SHALL exercise the public calculator endpoint against a deployed environment: ramp from 1 to 50 concurrent users over 60 seconds, hold 50 concurrent users for 120 seconds, with payload profiles for a light calculation (beer), a full calculation (spirits), and a multi-item basket. Thresholds: p95 latency < 2 s, error rate < 1 %, zero HTTP 429 responses attributable to the rate limiter in the steady-state window. The suite SHALL run as a post-deploy step in the staging deploy workflow, non-blocking until a baseline exists.

#### Scenario: Post-deploy load check runs against staging

- **WHEN** the staging deploy workflow completes a rollout
- **THEN** the HTTP load suite SHALL execute against the staging URL and report p95 latency, error rate, and 429 counts

#### Scenario: Threshold breach surfaces

- **WHEN** the suite observes p95 ≥ 2 s or an error rate ≥ 1 % in the steady window
- **THEN** the suite SHALL fail (non-blocking until a baseline is established, then blocking) with per-scenario metrics in the workflow summary

#### Scenario: Documentation names the real command

- **WHEN** a developer reads `docs/staging-verification.md` §5
- **THEN** the documented load-test commands SHALL match what the workflow actually executes, with the in-process benchmark and the HTTP-level suite described as distinct tools


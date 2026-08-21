# load-testing — Delta Spec

## MODIFIED Requirements

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

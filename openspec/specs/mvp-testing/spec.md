# mvp-testing Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Unit tests for high-liability code

Unit tests SHALL cover every tax/duty formula, classification rule, and confidence-computation function, at the highest coverage bar in the system.

#### Scenario: Formula regression

- **WHEN** a change touches an excise formula
- **THEN** the unit tests SHALL run and catch any deviation from the official rate

### Requirement: Golden-dataset regression tests

A fixed set of known product/transport/tax input combinations with manually verified expected outputs SHALL run on every deploy and every new tax-dataset version.

#### Scenario: Dataset version gate

- **WHEN** a new tax-dataset version is published
- **THEN** the golden-dataset tests SHALL pass against the manually verified expected outputs before the version ships

### Requirement: Compliance tests

Automated checks SHALL verify that no ranking result correlates with any commercial/payment signal and that banned promotional vocabulary does not appear in generated product copy.

#### Scenario: Neutrality check

- **WHEN** ranking results are produced
- **THEN** automated checks SHALL confirm no correlation with a payment signal

### Requirement: Load tests

Load/performance tests SHALL run against the Landed-Cost Calculation endpoint, the highest-traffic and most computation-heavy path.

#### Scenario: Endpoint under load

- **WHEN** the calculation endpoint is driven at production-scale concurrency
- **THEN** it SHALL meet the defined latency and throughput targets

### Requirement: Load test exercises the endpoint

The load/performance test for the Landed-Cost Calculation SHALL exercise the HTTP endpoint, or its orchestrator-only scope SHALL be documented in the test header so the coverage claim is accurate.

#### Scenario: HTTP-level load

- **WHEN** the load test runs
- **THEN** it SHALL measure the calculation path end-to-end (or state explicitly that it measures orchestrator throughput only)

### Requirement: Load test integration

A load test suite SHALL exist for the Landed-Cost Calculation endpoint, exercising the full HTTP path with realistic payloads, baseline thresholds, and non-blocking CI integration.

#### Scenario: Load test runs successfully

- **WHEN** the load test is invoked against a running instance
- **THEN** it SHALL complete, report p95 latency and error rate, and assert against defined thresholds

#### Scenario: Load test runs in CI

- **WHEN** a staging deployment completes
- **THEN** the load test SHALL be triggered and results reported (informational, not blocking)


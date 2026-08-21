# load-testing Specification

## Purpose

Performance and load testing on the Landed-Cost Calculation endpoint — the highest-traffic, most computation-heavy path in the system with real unit-economics implications.

## ADDED Requirements

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

The load test SHALL exercise the full HTTP endpoint (not only the orchestrator service in-process), measuring the complete request-to-response path including any database queries and external lookups.

#### Scenario: End-to-end measurement

- **WHEN** the load test runs
- **THEN** it SHALL measure the HTTP request-to-response cycle including network time, server processing, and any middleware pipeline overhead

### Requirement: CI integration (non-blocking initially)

The load test SHALL be runnable in CI against the staging environment after deployment. Initially it SHALL be non-blocking (informational only); it SHALL become blocking once the baseline is validated and any necessary optimizations are complete.

#### Scenario: CI runs load test after staging deploy

- **WHEN** a staging deployment completes
- **THEN** the load test SHALL be triggered against the staging URL and results SHALL be reported without blocking the deployment
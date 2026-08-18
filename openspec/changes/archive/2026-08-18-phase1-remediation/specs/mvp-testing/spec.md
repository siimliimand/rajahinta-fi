## ADDED Requirements

### Requirement: Load test exercises the endpoint

The load/performance test for the Landed-Cost Calculation SHALL exercise the HTTP endpoint, or its orchestrator-only scope SHALL be documented in the test header so the coverage claim is accurate.

#### Scenario: HTTP-level load

- **WHEN** the load test runs
- **THEN** it SHALL measure the calculation path end-to-end (or state explicitly that it measures orchestrator throughput only)

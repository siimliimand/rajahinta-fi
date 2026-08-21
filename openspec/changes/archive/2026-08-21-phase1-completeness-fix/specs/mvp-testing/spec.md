# mvp-testing — Delta Spec

## ADDED Requirements

### Requirement: Load test integration

A load test suite SHALL exist for the Landed-Cost Calculation endpoint, exercising the full HTTP path with realistic payloads, baseline thresholds, and non-blocking CI integration.

#### Scenario: Load test runs successfully

- **WHEN** the load test is invoked against a running instance
- **THEN** it SHALL complete, report p95 latency and error rate, and assert against defined thresholds

#### Scenario: Load test runs in CI

- **WHEN** a staging deployment completes
- **THEN** the load test SHALL be triggered and results reported (informational, not blocking)

### Requirement: Controller and guard test coverage

Controllers (DeclarationController, RankingController) and guards (EntitlementGuard) SHALL have unit tests verifying their behavior, delegation, and guard enforcement.

#### Scenario: Declaration controller tested

- **WHEN** the declaration controller tests run
- **THEN** they SHALL verify correct delegation to ExciseDeclarationService, EntitlementGuard enforcement, and error handling for missing calculation records

#### Scenario: Ranking methodology endpoint tested

- **WHEN** the ranking controller tests run
- **THEN** they SHALL verify the methodology response structure and that it matches RankingService output

#### Scenario: Entitlement guard tested

- **WHEN** the entitlement guard tests run
- **THEN** they SHALL verify feature-gating behavior (pass with sufficient tier, 403 with insufficient tier, pass when no feature required)

### Requirement: Core-domain test gaps filled

The SourceGovernanceService SHALL have functional tests for registerSource, checkPermission, revokePermission, revokeSourceById, and listMerchantSources. The ExciseDeclarationService SHALL have functional tests for prepareDeclaration behavior (success, CalculationRecordNotFoundError, advance-notice logic, MyTax link assembly).

#### Scenario: Governance service fully tested

- **WHEN** source governance tests run
- **THEN** they SHALL cover all six public methods of SourceGovernanceService with real assertions

#### Scenario: Declaration service functionally tested

- **WHEN** declaration service tests run
- **THEN** they SHALL test the prepareDeclaration success path, not-found error path, and advance-notice logic

### Requirement: Observability service tests

The KpiService, OpsDashboardController, CostAttributionService, and InstrumentationService SHALL have unit tests verifying metric recording, dashboard snapshot generation, cost attribution, and instrumentation facade behavior.

#### Scenario: KPI recording tested

- **WHEN** a KPI metric is recorded
- **THEN** the test SHALL verify it is buffered and flushed in the expected log format

#### Scenario: Cost attribution tested

- **WHEN** a calculation is attributed
- **THEN** the test SHALL verify cost data is recorded with merchant and category breakdowns
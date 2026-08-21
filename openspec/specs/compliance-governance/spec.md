# compliance-governance Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Audit logging

Changes to tax-rule datasets, classification rule sets, and ranking logic SHALL be logged with author, timestamp, and reason — via actual invocation of the audit service on every such change path (rate-review publish/approve, rule-set version publication, ranking-logic change), not merely by the existence of an audit service.

#### Scenario: Rate change audited

- **WHEN** a tax-rule dataset version is created or modified
- **THEN** the change SHALL be recorded with author, timestamp, and reason

#### Scenario: Publication path invokes audit

- **WHEN** a rate-review entry is approved and a new dataset version is published
- **THEN** the publish flow SHALL call the audit service and the event SHALL be persisted before the version becomes effective

#### Scenario: Rule-set and ranking changes audited

- **WHEN** a classification rule-set version is published or ranking logic changes
- **THEN** each SHALL produce an audit event with author, timestamp, and reason

#### Scenario: Coverage is regression-tested

- **WHEN** a change removes an audit invocation from a high-liability change path
- **THEN** a test SHALL fail

### Requirement: Launch gating

Alcohol price data and calculation features SHALL remain behind a non-public configuration flag until the legal opinion, tax-source mapping, and correction mechanism are confirmed complete.

#### Scenario: Pre-launch access denied

- **WHEN** the launch flag is off
- **THEN** alcohol price data and calculation features SHALL be inaccessible to the public regardless of other feature flags

### Requirement: Ranking transparency documentation

A public "how ranking works" page SHALL be generated from, or kept in lockstep with, the actual Ranking & Sorting Module implementation.

#### Scenario: Drift detection

- **WHEN** ranking logic changes
- **THEN** the documentation SHALL be updated to match, so the documented methodology cannot drift from real behavior

### Requirement: Launch gate enforced on endpoints

The launch-gating flag SHALL be enforced on the calculation and price-data endpoints, not merely defined as a service. Alcohol price data and calculation features SHALL be inaccessible while the flag is off.

#### Scenario: Calculation blocked pre-launch

- **WHEN** the launch gates are not all confirmed
- **THEN** `POST /api/v1/calculator` SHALL return 403 regardless of other feature flags

#### Scenario: Price data blocked pre-launch

- **WHEN** the legal-opinion gate is not confirmed
- **THEN** product/price discovery endpoints SHALL return 403

#### Scenario: Flag on after launch conditions

- **WHEN** legal opinion, tax-source mapping, and correction mechanism are all confirmed
- **THEN** calculation and price-data endpoints SHALL be reachable

### Requirement: Content vocabulary enforcement

The compliance governance module SHALL enforce the content vocabulary policy (no subjective/promotional adjectives) by integrating content linting into the data acquisition pipeline. Every product ingested SHALL be linted, and violations SHALL be recorded in the pipeline run report.

#### Scenario: Pipeline report includes violations

- **WHEN** a pipeline run ingests products containing banned promotional vocabulary
- **THEN** the pipeline run report SHALL include violation counts and details as a compliance signal

#### Scenario: Violation trend tracked

- **WHEN** compliance metrics are queried
- **THEN** the count of content vocabulary violations per pipeline run SHALL be available as a compliance KPI metric


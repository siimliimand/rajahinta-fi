# operator-console Specification

## Purpose
TBD - created by archiving change technical-assessment-remediation. Update Purpose after archive.
## Requirements
### Requirement: Operator console for human workflows

The system SHALL provide an authenticated operator console covering the three human workflows that currently have no UI: granting source-governance permission, confirming detected tax-rate versions, and working the correction queue. The console SHALL expose these workflows through both an API and a UI, and SHALL be reachable only by authenticated operators.

#### Scenario: Governance permission grant

- **WHEN** an operator grants source-governance permission for a merchant source in the console
- **THEN** the permission SHALL be recorded with the operator identity and timestamp, and ingestion for that source SHALL proceed under the governance gate

#### Scenario: Tax-rate confirmation

- **WHEN** a detected tax-rate version awaits confirmation
- **THEN** the console SHALL present the detected changes with provenance, and an operator confirmation SHALL move the version toward effectiveness while rejection SHALL keep the previous version effective

#### Scenario: Correction queue

- **WHEN** correction items exist in the queue
- **THEN** the console SHALL list them with their evidence and SHALL record resolution actions with operator identity and timestamp

#### Scenario: Unauthenticated access denied

- **WHEN** an unauthenticated or non-operator user reaches any console route
- **THEN** access SHALL be denied before any operational data is returned

### Requirement: Console actions are audited

Every action taken in the operator console SHALL write an audit event identifying the operator, the action, the target record, and the timestamp, persisted in the durable audit store.

#### Scenario: Audit trail complete

- **WHEN** any console workflow action completes
- **THEN** a corresponding audit event SHALL be queryable in the audit store

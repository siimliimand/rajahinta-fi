# compliance-governance — Delta Spec

## MODIFIED Requirements

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

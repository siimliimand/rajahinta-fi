# compliance-governance Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Audit logging

Changes to tax-rule datasets, classification rule sets, and ranking logic SHALL be logged with author, timestamp, and reason.

#### Scenario: Rate change audited

- **WHEN** a tax-rule dataset version is created or modified
- **THEN** the change SHALL be recorded with author, timestamp, and reason

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


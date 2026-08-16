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


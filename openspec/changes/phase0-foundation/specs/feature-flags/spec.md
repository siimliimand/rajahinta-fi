## ADDED Requirements

### Requirement: Compliance-sensitive feature gating

The system SHALL support feature flags that gate:
- New merchant sources
- New tax rulesets
- New UI ranking behavior

Each flag SHALL control whether the associated feature is visible or active for a given percentage of traffic or a specific user segment.

#### Scenario: Instant rollback via flag off

- **WHEN** a compliance issue is detected in a new merchant source that was rolled out under a feature flag
- **THEN** toggling the flag off SHALL immediately disable that merchant source for all users without a deploy or restart

#### Scenario: Phased rollout

- **WHEN** a new tax ruleset is ready
- **THEN** an operator SHALL be able to expose it to 1% of traffic, then 10%, then 100%, with the ability to roll back at any step

### Requirement: Flag evaluation on request path

Feature flag evaluation SHALL happen synchronously on the request path, not via a background refresh or stale cache, so a flag change takes effect on the immediate next request.

#### Scenario: Flag change effective immediately

- **WHEN** an operator toggles a flag from off to on
- **THEN** the next incoming request SHALL evaluate the flag as on
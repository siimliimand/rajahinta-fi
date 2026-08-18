# confidence-framework Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Data-reliability statuses

Every externally sourced data point SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED, attached to price, transport, and classification inputs.

#### Scenario: Estimated input

- **WHEN** a shipping cost is based on an assumption rather than a verified offer
- **THEN** that input SHALL be marked ESTIMATED and SHALL influence the result's confidence level

### Requirement: Computed result confidence

Result confidence SHALL be a pure function of the underlying data statuses, not a manually set field: HIGH when all material inputs are verified, MEDIUM when one or more are estimated, LOW when shipping or classification is unverifiable.

#### Scenario: Confidence drift prevention

- **WHEN** an input's reliability status changes from VERIFIED to STALE
- **THEN** the computed confidence SHALL change automatically to reflect the degraded input, without any manual update

### Requirement: Explainable confidence

The framework SHALL expose enough detail that the UI can show why a result has its confidence level.

#### Scenario: Confidence rationale

- **WHEN** a result has MEDIUM confidence
- **THEN** the UI SHALL be able to list which input or inputs were estimated


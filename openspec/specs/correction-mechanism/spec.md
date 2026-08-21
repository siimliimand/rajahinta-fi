# correction-mechanism Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Flag incorrect results

Users and internal staff SHALL be able to flag a specific calculation or data point as incorrect, creating a tracked review item.

#### Scenario: User flags a result

- **WHEN** a user flags a calculation as incorrect
- **THEN** a tracked review item SHALL be created referencing that calculation

### Requirement: Correction with back-linkage

Once a review item is resolved, the correction SHALL be able to trigger a dataset fix and link back to any affected historical Calculation Records.

#### Scenario: Dataset corrected

- **WHEN** a flagged data point is corrected
- **THEN** the correction SHALL link to the Calculation Records that used the incorrect data

### Requirement: Correction flow reachable via API

The correction mechanism SHALL expose an API so users and internal staff can flag a calculation or data point and track its review, rather than existing only as a domain service. The flow SHALL also be reachable from the user-facing web application: a flag affordance on the calculation result page SHALL submit to the correction API with the calculation record reference, so the correction-mechanism launch-gate condition is satisfied end-to-end, not API-only.

#### Scenario: Flag a calculation

- **WHEN** a user or staff member submits a flag against a calculation record
- **THEN** a tracked review item SHALL be created with the input snapshot preserved

#### Scenario: User flags from the result page

- **WHEN** a user activates the flag affordance on a calculator result
- **THEN** the web application SHALL submit a correction request referencing that calculation record, and the user SHALL receive confirmation that the review item was created


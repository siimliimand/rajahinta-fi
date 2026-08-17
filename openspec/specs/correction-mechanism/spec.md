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

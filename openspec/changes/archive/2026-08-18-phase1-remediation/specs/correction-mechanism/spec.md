## ADDED Requirements

### Requirement: Correction flow reachable via API

The correction mechanism SHALL expose an API so users and internal staff can flag a calculation or data point and track its review, rather than existing only as a domain service.

#### Scenario: Flag a calculation

- **WHEN** a user or staff member submits a flag against a calculation record
- **THEN** a tracked review item SHALL be created with the input snapshot preserved

#### Scenario: Resolve a flag

- **WHEN** a reviewer resolves a flagged item
- **THEN** the resolution SHALL be recorded and SHALL link back to affected historical Calculation Records

#### Scenario: List flags

- **WHEN** staff list flagged items
- **THEN** the API SHALL return open and resolved flags with their target type and status

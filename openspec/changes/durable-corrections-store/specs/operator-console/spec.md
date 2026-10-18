# operator-console — Correction queue durability delta

## ADDED Requirements

### Requirement: Correction queue is durable

The console correction queue SHALL read from and write to the durable D1 `corrections` store, and the fail-closed 503 `StoreUnavailable` path SHALL NOT exist for the correction routes. The tax rate-review routes are out of scope for this requirement.

#### Scenario: Queue lists persisted items

- **WHEN** an operator loads the console correction queue
- **THEN** the items are served from the D1 `corrections` table (newest first), each carrying id, targetType, targetId, reason, status, createdAt, resolvedAt, and resolution, with the total counting all rows

#### Scenario: Opened correction persists

- **WHEN** an operator submits a correction with a valid targetType, targetId, reason, and operator identity
- **THEN** a row is persisted in the D1 store with status `open`, a repository-assigned id, and ISO-8601 createdAt, and an audit event recording the operator and the new item is appended to the durable audit trail

#### Scenario: Resolved correction persists

- **WHEN** an operator resolves a correction with an operator identity and an optional note
- **THEN** the row's status becomes `resolved` with the note stored as the resolution and resolvedAt set, and an audit event recording the operator, the resolution, and the before/after values is appended to the durable audit trail

#### Scenario: Unknown correction id

- **WHEN** a resolve request references a correction id that does not exist
- **THEN** the API responds 404 and no audit event is written

#### Scenario: Validation failures stay 400

- **WHEN** an open or resolve request fails its payload validation (missing/invalid fields)
- **THEN** the API responds 400 without touching the store or the audit trail

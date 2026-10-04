# operator-console Delta

## ADDED Requirements

### Requirement: Offer verification action

The operator console SHALL provide a verify action (`POST /ops/console/offers/:id/verify`) that sets a retail offer's reliability status to VERIFIED and records the verifying operator and timestamp on the offer. The action SHALL follow the console trust pattern: bearer auth fail-closed before any data access, `validateOperator` attribution (a non-empty operator name is required), and one append-only audit event per verification carrying the operator identity, the offer id, the action, the previous status, and the new status. Re-verification SHALL be allowed — it overwrites the `verified_at`/`verified_by` attribution pair in place and appends a fresh audit event, so the decision history lives in the audit trail. The console SHALL provide no un-verify endpoint: superseding a verdict is a later operator decision, never an accidental status write. Ingestion SHALL keep pinning new offers to ESTIMATED — a human operator is the only writer of VERIFIED.

#### Scenario: Verification is attributed and audited

- **WHEN** an operator verifies an offer through the console endpoint
- **THEN** the offer's status reads VERIFIED with the operator and timestamp recorded on the offer, and an audit event carries the operator identity, the offer id, the action, and the timestamp

#### Scenario: Unauthenticated calls fail closed

- **WHEN** the verify endpoint is called without a valid bearer token
- **THEN** the request is rejected and no status change or audit event occurs

#### Scenario: Refusals write nothing

- **WHEN** the verify endpoint is called without a named operator, or for an offer id that does not exist
- **THEN** the request is rejected and the offer's status, its attribution columns, and the audit trail are all untouched

#### Scenario: Re-verification overwrites and re-audits

- **WHEN** a second operator verifies an offer that is already VERIFIED
- **THEN** the offer's attribution pair names the second operator and timestamp, and a second audit event joins the first

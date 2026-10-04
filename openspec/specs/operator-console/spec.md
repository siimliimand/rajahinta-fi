# operator-console Specification

## Purpose
TBD - created by archiving change technical-assessment-remediation. Update Purpose after archive.

## Requirements

### Requirement: Operator console for human workflows

The operator console SHALL cover the human workflows that remain after the FX removal: source-governance grants and revocations, tax-dataset version confirmations, and the correction queue. The FX dataset publish flow and its console section SHALL NOT exist. Every remaining console action SHALL stay audited in the append-only audit trail.

#### Scenario: No FX publish surface

- **WHEN** an operator loads the console dataset-confirmation view
- **THEN** only tax-dataset versions are listed for confirmation, and no FX publish endpoint exists in the API surface

### Requirement: Console actions are audited

Every action taken in the operator console SHALL write an audit event identifying the operator, the action, the target record, and the timestamp, persisted in the durable audit store.

#### Scenario: Audit trail complete

- **WHEN** any console workflow action completes
- **THEN** a corresponding audit event SHALL be queryable in the audit store

### Requirement: Durable governance store

The operator console SHALL persist source-governance records in D1, and the ingestion pipeline's permission gate SHALL read the same store. A grant or revoke performed through the console SHALL be visible to the gate on its next check without a deploy, and SHALL append an audit event recording the operator identity, the transition, and the reason. Merchants with no governance records SHALL aggregate to PENDING and the pipeline SHALL perform no fetch for them. The console SHALL have no mutation path that fails with a known-unservable store error.

#### Scenario: Grant persists and reaches the gate

- **WHEN** an operator grants the `alks` source (`RETAILER_API`, sourceUrl `https://alks.fi`) through the console
- **THEN** the record persists in D1 with status GRANTED, an audit event carries the operator identity and transition, the console list reports the merchant GRANTED, and the ingestion gate's next `checkPermission("alks")` aggregates to GRANTED without a deploy

#### Scenario: Revocation stops ingestion

- **WHEN** an operator revokes a merchant's sources with a reason
- **THEN** every source row transitions to REVOKED with the reason recorded, the audit trail carries the decision, the console reports the merchant not-GRANTED, and the gate fails the next fetch attempt

#### Scenario: No records stay fail-closed

- **WHEN** a merchant has no governance rows (an empty table)
- **THEN** the console reports PENDING with zero sources, the gate returns not-granted, and the pipeline performs no fetch for that merchant — identical to the pre-store fail-closed behavior

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

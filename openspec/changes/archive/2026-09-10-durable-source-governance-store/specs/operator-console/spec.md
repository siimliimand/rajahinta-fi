# operator-console Specification

## ADDED Requirements

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

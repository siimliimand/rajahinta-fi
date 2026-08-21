# accounts-age-gate — Delta Spec

## ADDED Requirements

### Requirement: Functional right to erasure

Account erasure (`anonymizeAccount`) SHALL be implemented for the PostgreSQL wiring — not only the in-memory fallback. Erasure SHALL irreversibly pseudonymize identifiers (retaining an anonymized skeleton only where referential integrity of calculation records requires it), cascade to saved baskets and linked personal data, and record an audit event.

#### Scenario: Erasure against PostgreSQL

- **WHEN** `anonymizeAccount` is invoked for an account stored in PostgreSQL
- **THEN** the account's identifiers SHALL be irreversibly replaced, its saved baskets SHALL be anonymized or deleted, and the operation SHALL NOT be a no-op or warning-only path

#### Scenario: No recoverable identifiers remain

- **WHEN** erasure completes and the database is inspected
- **THEN** no recoverable personal identifiers for that account SHALL remain; only anonymized skeleton rows permitted for referential integrity

### Requirement: No silent in-memory fallback in production

Outside test environments, the account service SHALL fail fast if its persistence repositories are not injected. The in-memory implementation SHALL exist only for the test harness; a dependency-injection misconfiguration SHALL produce a startup/constructor error, never a silently non-persistent production system.

#### Scenario: Missing repositories in production

- **WHEN** the account service is constructed without repositories in a non-test environment
- **THEN** it SHALL throw rather than silently fall back to in-memory storage

#### Scenario: Test harness unaffected

- **WHEN** the account service is constructed without repositories in a test environment
- **THEN** the in-memory harness SHALL continue to function as before

## MODIFIED Requirements

### Requirement: Retention and export

The system SHALL enforce retention limits with automated deletion/anonymization jobs driven by a scheduled recurring job, and SHALL provide data export reachable from the account UI covering the user's own data (GDPR portability). Retention, export, and erasure SHALL operate on the PostgreSQL-persisted data and SHALL be verifiable end-to-end against a real database.

#### Scenario: Retention expiry

- **WHEN** account data reaches its retention limit
- **THEN** an automated recurring job SHALL delete or anonymize it without manual intervention

#### Scenario: Data export request

- **WHEN** a user requests their data from the account page
- **THEN** the system SHALL return their calculation history and account data as a downloadable JSON payload

#### Scenario: End-to-end against PostgreSQL

- **WHEN** export, erasure, and retention are exercised against a PostgreSQL database across a process restart
- **THEN** all three SHALL behave correctly on persisted data (export complete, erasure irreversible, retention applied)

# accounts-age-gate Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Lightweight age gate

The application SHALL present a lightweight access-control age gate (simple confirmation, not identity verification) as the default.

#### Scenario: Age confirmation

- **WHEN** a user confirms they meet the age requirement
- **THEN** access to alcohol price data SHALL be granted without collecting identity documents

### Requirement: Pluggable verification

The account system's identity/age-verification components SHALL be a pluggable module that can be upgraded to stronger verification if the legal review requires it, without hard-coding a vendor into the core account model.

#### Scenario: Stronger verification required

- **WHEN** the legal opinion mandates stronger verification
- **THEN** a stronger verification flow SHALL be swappable into the pluggable module without redesigning the account model

### Requirement: Minimal account system

Accounts SHALL support saved baskets, calculation history, subscription management, and data export, and SHALL NOT gate viewing of publicly available comparison information.

#### Scenario: Anonymous browsing

- **WHEN** a visitor is not signed in
- **THEN** they SHALL still be able to view publicly available comparison information in a reduced form

### Requirement: Minimal personal data

The system SHALL default to anonymous usage, SHALL NOT store identity documents or unnecessary date-of-birth, SHALL collect personal data only for account-based features, and SHALL support anonymous session establishment with no personal data collection.

#### Scenario: No identity document storage

- **WHEN** an account is created
- **THEN** no identity document or unnecessary date-of-birth SHALL be collected or stored unless legally mandated

#### Scenario: Anonymous session establishment

- **WHEN** a user chooses to create an account or sign in
- **THEN** the system SHALL generate an anonymous session identity and persist it client-side, without collecting personal data

#### Scenario: Session propagates to API

- **WHEN** the web app makes an account-scoped request
- **THEN** it SHALL send the session identity so the request is attributed to the account

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

### Requirement: Server-side age gate

The age gate SHALL be enforced server-side on alcohol-content endpoints, not only as a frontend component. The gate remains a simple confirmation, not identity verification.

#### Scenario: Confirmation required

- **WHEN** a request reaches an alcohol-content endpoint without a valid confirmation token
- **THEN** the endpoint SHALL reject it with a clear age-confirmation requirement

#### Scenario: Public content exempt

- **WHEN** a request targets landing or comparison content
- **THEN** it SHALL remain reachable without a confirmation token

#### Scenario: No identity collection

- **WHEN** the age gate is used
- **THEN** no identity document or date-of-birth SHALL be collected

### Requirement: Account endpoints exposed

The minimal account system SHALL expose saved baskets, calculation history, and subscription status through the API, in addition to data export.

#### Scenario: Baskets

- **WHEN** an account holds saved baskets
- **THEN** the API SHALL list, save, and delete them

#### Scenario: History

- **WHEN** an account has calculation history
- **THEN** the API SHALL return it

#### Scenario: History recorded

- **WHEN** a user with an active session runs a calculation
- **THEN** the resulting record ID SHALL be appended to the user's calculation history

#### Scenario: Subscription status

- **WHEN** a user queries their subscription
- **THEN** the API SHALL return the current tier and status

### Requirement: Account persistence to PostgreSQL

The account system (saved baskets, calculation history, subscription status) SHALL be persisted to PostgreSQL using Drizzle ORM, replacing the Phase 1 in-memory Map implementation. The `AccountService` port interface SHALL remain unchanged; only the repository implementation changes.

#### Scenario: Account data survives restart

- **WHEN** the backend process restarts
- **THEN** all account data (baskets, history, subscription status) SHALL be preserved and queryable

#### Scenario: Same interface, new backend

- **WHEN** the account repository is swapped from in-memory to PostgreSQL
- **THEN** existing consumers (AccountController, DataExportService, AccountRetentionService) SHALL continue to function without code changes

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


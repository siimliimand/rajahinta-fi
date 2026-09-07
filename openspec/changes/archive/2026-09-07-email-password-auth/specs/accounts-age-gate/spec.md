# accounts-age-gate Specification

## MODIFIED Requirements

### Requirement: Minimal account system

Accounts SHALL be registered users identified by their email address and authenticated by credentials. Accounts SHALL support saved baskets, calculation history, subscription management, and data export, and SHALL NOT gate viewing of publicly available comparison information.

#### Scenario: Anonymous browsing

- **WHEN** a visitor is not signed in
- **THEN** they SHALL still be able to view publicly available comparison information in a reduced form

#### Scenario: Account features require sign-in

- **WHEN** a visitor who has not registered or signed in attempts an account-scoped action
- **THEN** the system SHALL direct them to sign in rather than create an identity on their behalf

### Requirement: Minimal personal data

The system SHALL NOT store identity documents or unnecessary date-of-birth, SHALL collect personal data only for account-based features, and SHALL collect nothing beyond the email address and password hash for authentication itself.

#### Scenario: No identity document storage

- **WHEN** an account is created
- **THEN** no identity document or unnecessary date-of-birth SHALL be collected or stored unless legally mandated

#### Scenario: Registration collects only credentials

- **WHEN** a user registers
- **THEN** the system SHALL store only the email address, the password hash, and operational timestamps — no profile data beyond them

#### Scenario: Session propagates to API

- **WHEN** the web app makes an account-scoped request
- **THEN** it SHALL send the session cookie so the request is attributed to the signed-in account

### Requirement: Retention and export

The system SHALL enforce retention limits with automated deletion/anonymization jobs driven by a scheduled recurring job, and SHALL provide data export reachable from the account UI covering the user's own data (GDPR portability). Retention, export, and erasure SHALL operate on the durably persisted account data (D1 in production) and SHALL be verifiable end-to-end against a real database.

#### Scenario: Retention expiry

- **WHEN** account data reaches its retention limit
- **THEN** an automated recurring job SHALL delete or anonymize it without manual intervention

#### Scenario: Data export request

- **WHEN** a user requests their data from the account page
- **THEN** the system SHALL return their calculation history and account data as a downloadable JSON payload

## REMOVED Requirements

### Requirement: Account persistence to PostgreSQL

The account system (saved baskets, calculation history, subscription status) SHALL be persisted to PostgreSQL using Drizzle ORM, replacing the Phase 1 in-memory Map implementation. The `AccountService` port interface SHALL remain unchanged; only the repository implementation changes.

#### Scenario: Account data survives restart

- **WHEN** the backend process restarts
- **THEN** all account data (baskets, history, subscription status) SHALL be preserved and queryable

#### Scenario: Same interface, new backend

- **WHEN** the account repository is swapped from in-memory to PostgreSQL
- **THEN** existing consumers (AccountController, DataExportService, AccountRetentionService) SHALL continue to function without code changes

## ADDED Requirements

### Requirement: Durable account persistence in D1

The account system (credentials, verification state, saved baskets, calculation history, subscription status, price alerts) SHALL be persisted durably in D1 via Drizzle: accounts carry a unique lowercased email, a PBKDF2 password hash, and a nullable `email_verified_at`; single-use email tokens live in their own hashed table. Account data SHALL survive process and Worker restarts.

#### Scenario: Account data survives restart

- **WHEN** the API Worker is redeployed or restarted
- **THEN** all account data (credentials, verification state, baskets, history, subscription status) SHALL be preserved and queryable

#### Scenario: Emails are unique

- **WHEN** registration attempts to reuse an existing email, differing only in letter case
- **THEN** the database-level uniqueness SHALL reject it, not only application validation

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

The system SHALL default to anonymous usage, SHALL NOT store identity documents or unnecessary date-of-birth, and SHALL collect personal data only for account-based features.

#### Scenario: No identity document storage

- **WHEN** an account is created
- **THEN** no identity document or unnecessary date-of-birth SHALL be collected or stored unless legally mandated

### Requirement: Retention and export

The system SHALL enforce retention limits with automated deletion/anonymization jobs, and SHALL provide data export covering the user's own data (GDPR portability).

#### Scenario: Retention expiry

- **WHEN** account data reaches its retention limit
- **THEN** an automated job SHALL delete or anonymize it

#### Scenario: Data export request

- **WHEN** a user requests their data
- **THEN** the system SHALL return their calculation history and account data in a portable form

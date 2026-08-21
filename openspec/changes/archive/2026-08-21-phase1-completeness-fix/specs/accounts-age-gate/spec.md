# accounts-age-gate — Delta Spec

## ADDED Requirements

### Requirement: Account persistence to PostgreSQL

The account system (saved baskets, calculation history, subscription status) SHALL be persisted to PostgreSQL using Drizzle ORM, replacing the Phase 1 in-memory Map implementation. The `AccountService` port interface SHALL remain unchanged; only the repository implementation changes.

#### Scenario: Account data survives restart

- **WHEN** the backend process restarts
- **THEN** all account data (baskets, history, subscription status) SHALL be preserved and queryable

#### Scenario: Same interface, new backend

- **WHEN** the account repository is swapped from in-memory to PostgreSQL
- **THEN** existing consumers (AccountController, DataExportService, AccountRetentionService) SHALL continue to function without code changes

### Requirement: Identity-document audit

The system SHALL be audited to verify that no identity document fields, date-of-birth fields, or other unnecessary personal-data fields exist anywhere in the Drizzle schema, account types, or age-gate providers. The audit result SHALL be documented.

#### Scenario: Audit confirms no identity fields

- **WHEN** a grep or schema inspection is performed across the codebase
- **THEN** no `dateOfBirth`, `identityDocument`, `passport`, `henkilötunnus`, or equivalent personal-identity fields SHALL be found in any schema or type definition

## MODIFIED Requirements

### Requirement: Minimal account system

Accounts SHALL support saved baskets, calculation history, subscription management, and data export, and SHALL NOT gate viewing of publicly available comparison information. Account data SHALL be persisted to PostgreSQL (not in-memory only).

#### Scenario: Anonymous browsing

- **WHEN** a visitor is not signed in
- **THEN** they SHALL still be able to view publicly available comparison information in a reduced form

#### Scenario: Account data persistent

- **WHEN** a signed-in user saves a basket or calculation history
- **THEN** that data SHALL survive application restarts and SHALL be retrievable in subsequent sessions
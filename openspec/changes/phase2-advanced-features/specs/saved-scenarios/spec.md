# saved-scenarios Specification

## Purpose

Named, reloadable calculator input sets scoped to an account: a user can save the current calculator state (product, quantity, destination, transport inputs) under a name and reload it later to re-run the calculation against current data. Implements T2.10 of the implementation plan, following the saved-baskets account-data pattern.

## ADDED Requirements

### Requirement: Named calculation scenarios

The system SHALL allow an account user to save the current calculator inputs (product, quantity, destination, transport method/arrangement) under a caller-chosen name, and SHALL store scenarios uniquely per (account, name) — saving with an existing name SHALL replace that scenario's inputs. A scenario SHALL store only calculator inputs; no personal data beyond the account reference SHALL be collected (data minimization).

#### Scenario: Save a scenario

- **WHEN** a user saves the current calculator inputs under a new name
- **THEN** the system SHALL persist the scenario for that account and return it in subsequent list calls

#### Scenario: Save with an existing name

- **WHEN** a user saves a scenario using a name that already exists for their account
- **THEN** the system SHALL replace the stored inputs for that name rather than creating a duplicate

#### Scenario: Reload a scenario

- **WHEN** a user loads a saved scenario
- **THEN** the system SHALL return the stored inputs so the client can repopulate the calculator, and any result SHALL come from re-running the calculation against current data — scenario data SHALL never serve as a cached result

#### Scenario: Stale scenario references a removed product

- **WHEN** a user loads a scenario whose product no longer exists
- **THEN** the system SHALL surface a normal not-found outcome, never a stale or synthetic result

### Requirement: Scenario API

The system SHALL expose scenario operations at `/api/v1/account/scenarios` — list (with inputs), save (upsert by name), and delete — following the existing account identification pattern, and gated by the `enable_advanced_features` feature flag.

#### Scenario: Flag off blocks scenarios

- **WHEN** the `enable_advanced_features` flag is disabled
- **THEN** the scenario endpoints SHALL not serve requests

#### Scenario: Round trip

- **WHEN** a user saves, lists, loads, and deletes a scenario
- **THEN** each operation SHALL behave as specified and the deleted scenario SHALL no longer appear in the list

### Requirement: Scenario data lifecycle

Saved scenarios ARE account data and SHALL follow the same lifecycle as other account data: inclusion in the user's GDPR data export, deletion on account erasure (cascade), and coverage by account retention.

#### Scenario: Export includes scenarios

- **WHEN** a user requests their data export
- **THEN** the export payload SHALL include their saved scenarios

#### Scenario: Erasure cascades

- **WHEN** an account is anonymized or erased
- **THEN** the account's saved scenarios SHALL be deleted or irreversibly anonymized along with the other account data

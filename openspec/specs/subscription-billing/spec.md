# subscription-billing Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Third-party billing integration

The system SHALL integrate with a third-party subscription billing provider for software subscriptions (Free / Premium €4.99/month / future Professional tier), never processing alcohol purchases.

#### Scenario: Premium subscription

- **WHEN** a user subscribes to Premium
- **THEN** the subscription state SHALL be managed by the third-party provider and reflected in the entitlement module

### Requirement: Structural separation from ranking

The billing module and the Ranking & Sorting Module SHALL have no shared write path, so a merchant account cannot purchase better placement.

#### Scenario: No billing-to-ranking path

- **WHEN** a merchant pays for a subscription or promotion
- **THEN** there SHALL be no code path by which that payment could reach the Ranking & Sorting Module's inputs

### Requirement: Billing deferral recorded

Third-party subscription billing SHALL be explicitly deferred to Phase 2 and recorded as such, with the billing service kept as a stable interface stub rather than silently claiming completion.

#### Scenario: Stable stub interface

- **WHEN** billing is queried in Phase 1
- **THEN** a stable, documented stub response SHALL be returned for all tiers

#### Scenario: Deferral documented

- **WHEN** the Phase 1 task list is reviewed
- **THEN** the billing integration task SHALL be marked deferred to Phase 2, not complete

### Requirement: Billing-ranking separation retained

The billing module SHALL have no code path connecting a merchant account to the Ranking & Sorting Module inputs, regardless of the deferral.

#### Scenario: No shared write path

- **WHEN** billing and ranking modules are inspected
- **THEN** no shared write path SHALL exist between them

### Requirement: Tier resolves from the account record

The entitlement tier SHALL be read from the account record's tier column. Environment-variable tier overrides SHALL remain only as a global testing override, never a per-user mechanism keyed on user identifiers.

#### Scenario: Tier from database

- **WHEN** entitlements resolve for an account with tier PREMIUM in the database
- **THEN** the resolved tier SHALL be PREMIUM regardless of any per-user environment variable

#### Scenario: Global test override still works

- **WHEN** the global test override is set in a non-production environment
- **THEN** it SHALL apply uniformly for testing purposes

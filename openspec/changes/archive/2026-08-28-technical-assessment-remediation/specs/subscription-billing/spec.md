# subscription-billing Specification Delta

## ADDED Requirements

### Requirement: Tier resolves from the account record

The entitlement tier SHALL be read from the account record's tier column. Environment-variable tier overrides SHALL remain only as a global testing override, never a per-user mechanism keyed on user identifiers.

#### Scenario: Tier from database

- **WHEN** entitlements resolve for an account with tier PREMIUM in the database
- **THEN** the resolved tier SHALL be PREMIUM regardless of any per-user environment variable

#### Scenario: Global test override still works

- **WHEN** the global test override is set in a non-production environment
- **THEN** it SHALL apply uniformly for testing purposes

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


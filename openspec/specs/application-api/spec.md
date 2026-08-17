# application-api Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Module-grouped API surface

The consumer-facing API SHALL be grouped by module (Search & Product Discovery, Landed-Cost Calculation, Excise Declaration Assistant, Account & Subscription), not by database table.

#### Scenario: Calculation endpoint

- **WHEN** a client calls the Landed-Cost Calculation endpoint
- **THEN** it SHALL receive the itemized result with classification, confidence, and disclaimer, without needing to call transport, tax, or classification endpoints separately

### Requirement: Idempotent calculation endpoints

Calculation endpoints SHALL be idempotent for identical inputs given the same underlying dataset versions, keeping results reproducible and cacheable.

#### Scenario: Repeated identical request

- **WHEN** two requests carry the same inputs and dataset versions
- **THEN** the endpoint SHALL return the same result

### Requirement: Version-keyed caching

Caching SHALL be keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version), driven by dataset version changes rather than arbitrary TTLs.

#### Scenario: Dataset bump invalidates cache

- **WHEN** a new tax-dataset version goes live
- **THEN** previously cached results SHALL be invalidated by the version change without waiting for a TTL expiry

### Requirement: Rate limiting and abuse protection

Public-facing calculation endpoints SHALL enforce rate limiting and abuse protection, since each calculation can trigger downstream merchant/transport lookups.

#### Scenario: Rate limit exceeded

- **WHEN** a client exceeds the configured rate limit
- **THEN** the endpoint SHALL reject further requests until the window resets

### Requirement: Shared entitlement enforcement

Free vs. premium feature access SHALL be enforced by a single shared entitlement module consulted by every relevant endpoint, not duplicated per feature.

#### Scenario: Premium-gated feature

- **WHEN** a free-tier user requests a premium-gated feature
- **THEN** the shared entitlement module SHALL deny access consistently across all endpoints

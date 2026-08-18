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

### Requirement: Redis-backed version-keyed cache

Calculation caching SHALL be Redis-backed and keyed by input plus tax/transport dataset versions, invalidating on dataset-version change rather than wall-clock TTL alone.

#### Scenario: Cache hit

- **WHEN** an identical calculation arrives under the same dataset versions
- **THEN** the cached result SHALL be served without recomputation

#### Scenario: Dataset version invalidation

- **WHEN** the tax or transport dataset version changes
- **THEN** previously cached results for the affected version SHALL be invalidated

### Requirement: Correct validation responses

Input validation SHALL return correct 4xx statuses: 400 for malformed input and 422 for classification-gate rejection, not a 500-class exception with a status override.

#### Scenario: Malformed input

- **WHEN** a calculation request fails input validation
- **THEN** the API SHALL return 400

#### Scenario: Classification gate rejection

- **WHEN** a product is rejected by the classification gate
- **THEN** the API SHALL return 422


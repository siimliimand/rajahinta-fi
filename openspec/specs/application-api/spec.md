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

Caching SHALL be keyed by (product, quantity, destination, transport assumption, transport arrangement, tax-dataset version, transport-dataset version), driven by dataset version changes rather than arbitrary TTLs. The resolved dataset versions SHALL participate in the cache key itself so that different dataset versions can never collide on one cache entry; any lookup-time version comparison is defence in depth, not the primary mechanism.

#### Scenario: Dataset bump invalidates cache

- **WHEN** a new tax-dataset version goes live
- **THEN** previously cached results SHALL be invalidated by the version change without waiting for a TTL expiry

#### Scenario: Versions participate in the key

- **WHEN** two identical product inputs are calculated under different tax-dataset versions
- **THEN** they SHALL produce distinct cache keys and the second calculation SHALL NOT return the first version's cached result

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

### Requirement: Click analytics endpoint

The API SHALL expose an endpoint to record a click-through on an outbound merchant link. The endpoint SHALL record counts only and SHALL NOT accept or store any purchase or commission data.

#### Scenario: Click recorded

- **WHEN** a client reports a merchant-link click
- **THEN** the endpoint SHALL increment a click count for that merchant/link

#### Scenario: No commission data

- **WHEN** a client reports a click
- **THEN** no affiliate, commission, or purchase-tracking payload SHALL be accepted or stored

### Requirement: Calculation history endpoint

The API SHALL expose an endpoint to append a calculation record ID to a user's calculation history.

#### Scenario: History appended

- **WHEN** a client posts a calculation record ID for a valid user
- **THEN** the record ID SHALL be appended to that user's history and returned

### Requirement: Age-gate coverage on alcohol-content endpoints

Every API endpoint that returns alcohol product data or calculation results SHALL be protected by the server-side age gate. Coverage SHALL be regression-tested: a test SHALL enumerate the exposed routes and fail if an alcohol-content route exists without the guard.

#### Scenario: New alcohol route ships unguarded

- **WHEN** a controller adds a route exposing alcohol product data without the age gate
- **THEN** the coverage test SHALL fail

#### Scenario: Guarded routes enumerated

- **WHEN** the age-gate coverage test runs
- **THEN** it SHALL assert the guard on every alcohol-content route across all controllers


# Spec Delta

## ADDED Requirements

### Requirement: Stable server-fetch cache identity

The frontend SHALL ensure that automatically generated per-request correlation metadata does not change the cache identity of a server-side fetch configured with a positive revalidation window. Identical URLs, methods, and cache-relevant request options SHALL reuse the same cached entry across independent requests and regenerated W3C trace context. Explicit caller-provided headers SHALL retain their existing framework cache-key semantics.

#### Scenario: Repeated cached read has stable identity

- **WHEN** the same positive-revalidation server fetch executes twice with different automatically generated trace context
- **THEN** both executions resolve to the same Next fetch-cache key, and the second execution within the revalidation window does not create another `.fetch` object or call the origin API

#### Scenario: Shared footer reads do not multiply cache entries

- **WHEN** localized pages render the shared footer repeatedly within the blog and guides revalidation window
- **THEN** each locale's blog and guides index reads reuse their existing cache entries instead of creating one entry per page render

#### Scenario: Revalidation refreshes the existing entry

- **WHEN** a cached server fetch reaches its revalidation window
- **THEN** revalidation refreshes the same cache entry without deriving a new cache identity from newly generated trace context

### Requirement: Frontend incremental-cache retention

The staging and production frontend R2 incremental-cache buckets SHALL have a lifecycle rule that expires objects 30 days after upload. The rule SHALL apply only to frontend cache buckets and SHALL NOT change observation logs, rate snapshots, D1 records, or other durable data. Expired cache entries SHALL be replaceable by rendering or fetching their source data again.

#### Scenario: Deployed cache buckets carry the expiry rule

- **WHEN** lifecycle configuration is inspected for `rajahinta-frontend-cache-staging` or `rajahinta-frontend-cache-production`
- **THEN** it contains an object-expiration rule with a 30-day expiration period

#### Scenario: Expired cache data is regenerated

- **WHEN** an incremental-cache entry expires and its route or data is requested again
- **THEN** the frontend regenerates and caches the entry from its source rather than treating expiration as a correctness failure

#### Scenario: Durable stores are unaffected

- **WHEN** the frontend cache lifecycle rule is applied
- **THEN** no lifecycle or data-retention behavior changes for observation logs, rate snapshots, D1, or other durable stores

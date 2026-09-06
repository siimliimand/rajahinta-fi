# application-api Specification

## MODIFIED Requirements

### Requirement: Version-keyed caching

Calculation idempotency cache keys SHALL be composed from the request payload plus the tax-dataset and transport-rate dataset versions. The FX dataset version component SHALL NOT exist.

#### Scenario: Cache key composition

- **WHEN** an idempotency key is built for a calculation request
- **THEN** the key incorporates the tax and transport versions only, and two identical requests with the same versions resolve to one cached result

### Requirement: Version-keyed idempotency on a Durable Object

The `IdempotencyDO` SHALL apply the same version-aware key rule as the Nest service, minus the FX component, and SHALL keep the version-aware invalidation semantics for tax and transport datasets.

#### Scenario: Version change invalidates

- **WHEN** a tax-dataset version changes between two identical calculation requests
- **THEN** the Durable Object treats the second request as a fresh calculation rather than replaying the cached result

## ADDED Requirements

### Requirement: Benchmark field on the calculator contract

The calculator response DTO SHALL include the optional `alkoBenchmark` field as specified in the landed-cost-calculator capability. The field SHALL be absent (not null, not a placeholder object) when no reference exists, and legacy persisted records without the field SHALL be served unchanged.

#### Scenario: Old records keep serving

- **WHEN** a calculation record created before this change is fetched by record id
- **THEN** the response contains no `alkoBenchmark` key and the request succeeds

# application-api — Delta Spec

## ADDED Requirements

### Requirement: Age-gate coverage on alcohol-content endpoints

Every API endpoint that returns alcohol product data or calculation results SHALL be protected by the server-side age gate. Coverage SHALL be regression-tested: a test SHALL enumerate the exposed routes and fail if an alcohol-content route exists without the guard.

#### Scenario: New alcohol route ships unguarded

- **WHEN** a controller adds a route exposing alcohol product data without the age gate
- **THEN** the coverage test SHALL fail

#### Scenario: Guarded routes enumerated

- **WHEN** the age-gate coverage test runs
- **THEN** it SHALL assert the guard on every alcohol-content route across all controllers

## MODIFIED Requirements

### Requirement: Version-keyed caching

Caching SHALL be keyed by (product, quantity, destination, transport assumption, transport arrangement, tax-dataset version, transport-dataset version), driven by dataset version changes rather than arbitrary TTLs. The resolved dataset versions SHALL participate in the cache key itself so that different dataset versions can never collide on one cache entry; any lookup-time version comparison is defence in depth, not the primary mechanism.

#### Scenario: Dataset bump invalidates cache

- **WHEN** a new tax-dataset version goes live
- **THEN** previously cached results SHALL be invalidated by the version change without waiting for a TTL expiry

#### Scenario: Versions participate in the key

- **WHEN** two identical product inputs are calculated under different tax-dataset versions
- **THEN** they SHALL produce distinct cache keys and the second calculation SHALL NOT return the first version's cached result

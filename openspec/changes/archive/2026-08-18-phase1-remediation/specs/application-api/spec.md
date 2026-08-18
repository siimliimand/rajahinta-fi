## ADDED Requirements

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

# product-search Specification Delta

## MODIFIED Requirements

### Requirement: Query parameter filters results

Product search SHALL filter and rank results from D1 using an FTS5 virtual table over product names with a `LIKE` substring fallback, replacing the `pg_trgm` implementation while preserving the observed behavior: the same query parameters (including blank-query passthrough and pagination interplay) return deterministic, stably ordered results.

#### Scenario: Ranked search on D1

- **WHEN** a search query is submitted that matched under `pg_trgm`
- **THEN** D1-backed search returns the same products in a deterministic ranked order

#### Scenario: Blank query passthrough

- **WHEN** a blank query is submitted
- **THEN** the endpoint behaves as today (passthrough semantics unchanged)

## ADDED Requirements

### Requirement: Search parity with golden fixtures

Search SHALL pass a golden parity check: every golden-fixture query (including typo-adjacent and partial-name cases such as "karhu") SHALL return the expected product within the accepted top-k on the D1 implementation. The parity suite SHALL run in CI against the D1-backed search.

#### Scenario: Golden query parity

- **WHEN** the golden search suite runs against D1
- **THEN** every fixture query finds its expected product within the accepted top-k, and a miss fails the build

# product-search Specification Delta

## ADDED Requirements

### Requirement: Query parameter filters results

`GET /api/v1/products` SHALL implement the documented `q` parameter: matching products over name, brand, and manufacturer using PostgreSQL text matching (`pg_trgm` similarity or tsvector full-text search), ranked deterministically. Existing pagination and sort orders SHALL be preserved and SHALL compose with query filtering.

#### Scenario: Query matches by name

- **WHEN** a user searches for "karhu"
- **THEN** products whose name, brand, or manufacturer match the query SHALL be returned in preference to non-matches

#### Scenario: Blank query passes through

- **WHEN** `q` is absent, empty, or whitespace
- **THEN** the endpoint SHALL behave exactly as the unfiltered product list with the existing default ordering

#### Scenario: Deterministic ranking

- **WHEN** the same query is issued twice against unchanged data
- **THEN** the result order SHALL be identical, using a deterministic tiebreaker such as product id

#### Scenario: Pagination composes

- **WHEN** a query is combined with page, limit, and sort parameters
- **THEN** filtering SHALL apply before pagination and the requested sort SHALL be honored over the filtered set

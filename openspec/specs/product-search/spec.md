# product-search Specification

## Purpose
TBD - created by archiving change technical-assessment-remediation. Update Purpose after archive.
## Requirements
### Requirement: Query parameter filters results

Product search SHALL filter and rank results from D1 using an FTS5 virtual table over product names with a `LIKE` substring fallback, replacing the `pg_trgm` implementation while preserving the observed behavior: the same query parameters (including blank-query passthrough and pagination interplay) return deterministic, stably ordered results.

#### Scenario: Ranked search on D1

- **WHEN** a search query is submitted that matched under `pg_trgm`
- **THEN** D1-backed search returns the same products in a deterministic ranked order

#### Scenario: Blank query passthrough

- **WHEN** a blank query is submitted
- **THEN** the endpoint behaves as today (passthrough semantics unchanged)

### Requirement: Search parity with golden fixtures

Search SHALL pass a golden parity check: every golden-fixture query (including typo-adjacent and partial-name cases such as "karhu") SHALL return the expected product within the accepted top-k on the D1 implementation. The parity suite SHALL run in CI against the D1-backed search.

#### Scenario: Golden query parity

- **WHEN** the golden search suite runs against D1
- **THEN** every fixture query finds its expected product within the accepted top-k, and a miss fails the build

### Requirement: Category filter on the product listing

The product listing SHALL accept a `category` parameter constrained to the canonical category value set enforced by the product schema, and SHALL return only products of that category. An unknown category value SHALL be rejected with a client error. The value set SHALL be defined once and shared between the schema constraint and the route validation.

#### Scenario: Category filters the listing

- **WHEN** the listing is requested with a canonical category value
- **THEN** only products of that category are returned

#### Scenario: Unknown category rejected

- **WHEN** the listing is requested with a value outside the canonical set
- **THEN** the endpoint SHALL respond with a 400 error and SHALL NOT fall back to an unfiltered listing

### Requirement: Database-level pagination with true totals

The product listing SHALL paginate at the database level and SHALL report `total` and `totalPages` reflecting the entire filtered catalog, not a fetch-capped subset. The result order SHALL remain the deterministic Finnish-collation alphabetical order of the existing listing contract.

#### Scenario: Totals beyond the legacy cap

- **WHEN** the filtered catalog contains more products than the legacy in-memory fetch cap
- **THEN** `total` SHALL equal the full filtered count and every page SHALL be retrievable

#### Scenario: Deterministic order preserved

- **WHEN** the same listing request is repeated
- **THEN** the products and their order SHALL be identical, ordered alphabetically under Finnish collation

### Requirement: Offer aggregates populated on the listing

Listing items SHALL carry `lowestPriceCents` and `merchantCount` aggregated from the product's retail offers. A product with no offers SHALL carry a null price and a zero merchant count rather than a guessed value.

#### Scenario: Product with offers

- **WHEN** a listed product has offers from multiple merchants
- **THEN** the item SHALL carry the lowest offer price in EUR cents and the distinct merchant count

#### Scenario: Product without offers

- **WHEN** a listed product has no retail offers
- **THEN** `lowestPriceCents` SHALL be null and `merchantCount` SHALL be 0

### Requirement: Search paths unchanged

The `ids` lookup and the ranked free-text `q` search SHALL keep their existing fetch-and-slice behavior, response shape, and ordering; the browse-path rework SHALL NOT alter them.

#### Scenario: Ranked search contract preserved

- **WHEN** the listing is requested with a free-text `q`
- **THEN** the response SHALL be byte-identical in shape and ordering semantics to the pre-change ranked search

### Requirement: Search result rows carry offer aggregates

Each product search row SHALL carry `lowestPriceCents` and `merchantCount` computed from the same offer set the product-detail endpoint serves for that product. The aggregates SHALL NOT be null/zero when the detail endpoint lists offers for the same id.

#### Scenario: Row aggregates match product detail

- **WHEN** a product has offers visible on its detail endpoint
- **THEN** its search row reports the same offer count and the same minimum price in cents

#### Scenario: Offer-less products stay honestly empty

- **WHEN** a product has no offers
- **THEN** the search row reports `lowestPriceCents: null` and `merchantCount: 0`

### Requirement: Calculator surfaces price before calculation

The calculator's search result rows SHALL render the lowest observed price when present, and the Configure step SHALL render the selected product's best current price before the first calculation runs.

#### Scenario: Search row shows price

- **WHEN** a search result row's product has offers
- **THEN** the row displays the lowest observed price in euros

#### Scenario: Configure step shows the selected price

- **WHEN** the user selects a product with offers
- **THEN** the Configure step displays the best current price before any calculation is triggered


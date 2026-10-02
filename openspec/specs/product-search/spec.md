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

### Requirement: Catalog page keyword search combined with category

The `/products` catalog page SHALL offer a keyword search input whose value lives in the URL query state (`q`). When both `q` and `category` are present, the repository search SHALL apply both filters together; the category filter SHALL NEVER be silently ignored because a keyword is present.

#### Scenario: Search from the catalog page

- **WHEN** a visitor types "karhu" into the catalog search input
- **THEN** the page renders keyword matches for "karhu" with the URL carrying `q=karhu`

#### Scenario: Category and keyword combine

- **WHEN** a request carries both `q=karhu` and `category=beer`
- **THEN** the result set contains only products matching the keyword whose category is `beer`

### Requirement: Server-side catalog sorting

`GET /api/v1/products` SHALL support a `sort` parameter with at least `LOWEST_PRICE` (ascending by the product's lowest observed offer price, products without offers last), `ALCOHOL_PERCENTAGE` (descending), and alphabetical as the default. Sort orders SHALL use only objective product and observed-offer fields; no commercial or promotional signal can affect ordering. An unknown `sort` value SHALL be rejected as a 400 contract error, matching the unknown-category treatment.

#### Scenario: Price sort orders by observed lowest price

- **WHEN** the request carries `sort=LOWEST_PRICE`
- **THEN** rows order by lowest observed offer price ascending, and products without offers render after all priced rows

#### Scenario: ABV sort is deterministic

- **WHEN** the request carries `sort=ALCOHOL_PERCENTAGE`
- **THEN** rows order by alcohol by volume descending with a deterministic tiebreaker, and the same data always produces the same order

#### Scenario: Unknown sort value is a contract error

- **WHEN** the request carries `sort=PROMOTED`
- **THEN** the API responds 400 with the unified error envelope and no results are computed

### Requirement: Finnish synonym recall

Product keyword search SHALL expand query tokens through a curated static Finnish↔English synonym map (category- and term-level equivalence groups, versioned in code). Expansion SHALL produce OR-groups inside the FTS5 MATCH expression so a query matches any group member, with prefix expansion applied to every member of the final token's group. Expansion SHALL never narrow a result set relative to the un-expanded query. The user's query text SHALL NOT be rewritten in the response.

#### Scenario: Finnish term recalls the English-language catalog

- **WHEN** the search query is `viski`
- **THEN** results include products matching `whisky`, with recall at least equal to the un-expanded match set for `viski`

#### Scenario: Expansion is monotone

- **WHEN** any synonym-expanded query is executed
- **THEN** the result set is a superset of the same query executed without expansion

### Requirement: Substring merge scarcity gating

The `LIKE '%q%'` mid-token merge SHALL be consulted only when the FTS token-match candidate count is below the listing page size; at or above it, the merge is skipped. Fragment recall SHALL be preserved when token matches are absent or scarce (e.g. `arhu` → Karhu). The gate SHALL NOT change the ranking semantics of the paths it does run.

#### Scenario: Common short word is not flooded by brand-substring noise

- **WHEN** the query `olut` returns FTS token matches at or above the page size
- **THEN** the result head contains token matches only — mid-token substring rows such as brand names merely containing the letters are absent

#### Scenario: Fragment recall survives the gate

- **WHEN** the query `arhu` produces no FTS token matches
- **THEN** the LIKE merge runs and returns the mid-token matches as before

### Requirement: Zero-result suggestion

When a keyword query returns zero results, the response SHALL carry an optional `suggestion`: a deterministic candidate computed by bounded edit distance (≤ 2) against the product brand-token vocabulary, with diacritic folding (ä/ö/å → a/o/a) applied to the comparison keys only. Candidate ordering SHALL be (edit distance, then alphabetical). No suggestion SHALL be returned when the query has results or no candidate is within the distance bound. The original query SHALL remain the response's query; the suggestion is advisory and never applied implicitly.

#### Scenario: Misspelled brand name yields a suggestion

- **WHEN** the query `koskenkrova` returns zero results
- **THEN** the response carries `suggestion` = a product brand token within the distance bound (Koskenkorva)

#### Scenario: No suggestion when results exist

- **WHEN** a query returns one or more results
- **THEN** the response carries no suggestion

#### Scenario: Deterministic ordering

- **WHEN** multiple candidates share the minimal edit distance
- **THEN** the suggestion is the alphabetically first among them, stable across requests

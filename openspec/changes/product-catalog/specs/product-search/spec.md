# product-search Specification

## ADDED Requirements

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

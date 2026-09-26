# product-search Specification

## MODIFIED Requirements

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

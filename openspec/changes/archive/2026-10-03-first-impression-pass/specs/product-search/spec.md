# Spec Delta: product-search

## MODIFIED Requirements

### Requirement: Server-side catalog sorting

`GET /api/v1/products` SHALL support a `sort` parameter with at least `LOWEST_PRICE` (ascending by the product's lowest observed offer price, products without offers last), `ALCOHOL_PERCENTAGE` (descending), and alphabetical. The default order SHALL be `LOWEST_PRICE`: a request without a `sort` parameter SHALL order by lowest observed offer price ascending, with offer-less products rendered after all priced rows, deterministically — the ordering SHALL be explicit against the engine's ascending NULL order, never incidental. Sort orders SHALL use only objective product and observed-offer fields; no commercial or promotional signal can affect ordering. An unknown `sort` value SHALL be rejected as a 400 contract error, matching the unknown-category treatment.

#### Scenario: Price sort orders by observed lowest price

- **WHEN** the request carries `sort=LOWEST_PRICE`
- **THEN** rows order by lowest observed offer price ascending, and products without offers render after all priced rows

#### Scenario: Absent sort parameter defaults to price order

- **WHEN** the request carries no `sort` parameter
- **THEN** rows order exactly as `sort=LOWEST_PRICE` — lowest observed offer price ascending, offer-less products after all priced rows

#### Scenario: ABV sort is deterministic

- **WHEN** the request carries `sort=ALCOHOL_PERCENTAGE`
- **THEN** rows order by alcohol by volume descending with a deterministic tiebreaker, and the same data always produces the same order

#### Scenario: Unknown sort value is a contract error

- **WHEN** the request carries `sort=PROMOTED`
- **THEN** the API responds 400 with the unified error envelope and no results are computed

# product-search Specification

## ADDED Requirements

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

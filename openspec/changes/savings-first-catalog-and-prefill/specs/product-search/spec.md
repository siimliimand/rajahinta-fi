# product-search Delta

## MODIFIED Requirements

### Requirement: Server-side catalog sorting

`GET /api/v1/products` SHALL support a `sort` parameter with at least
`LOWEST_PRICE` (ascending by the product's lowest observed offer price,
products without offers last), `ALCOHOL_PERCENTAGE` (descending),
`ALPHABETICAL`, and `BIGGEST_SAVING`. The default order SHALL be
`BIGGEST_SAVING`: a request without a `sort` parameter SHALL order by the
product's savings gap in basis points ascending (the largest saving first),
with the FI-collated product name and the product id as deterministic
tie-breaks. Products without a savings-snapshot row for the latest materialized
day SHALL list after all covered rows, ordered alphabetically with the same
tie-break. `BIGGEST_SAVING` SHALL be computed only from the materialized
savings snapshot read at the route/display layer; the product-search repository
SHALL NOT import any savings module, and no calculation, ranking, or
optimization input SHALL change. Sort orders SHALL use only objective product,
observed-offer, and published materialized-gap fields; no commercial or
promotional signal can affect ordering. An unknown `sort` value SHALL be
rejected as a 400 contract error, matching the unknown-category treatment.

#### Scenario: Price sort orders by observed lowest price

- **WHEN** the request carries `sort=LOWEST_PRICE`
- **THEN** rows order by lowest observed offer price ascending, and products without offers render after all priced rows

#### Scenario: Absent sort parameter defaults to biggest saving

- **WHEN** the request carries no `sort` parameter and the latest savings day has covered rows
- **THEN** rows order by gap basis points ascending (largest saving first) with deterministic tie-breaks, and the same data always produces the same order

#### Scenario: Products without a savings row list last

- **WHEN** the request uses the default order and some products have no snapshot row for the latest day
- **THEN** every covered row renders before every uncovered row, and uncovered rows order alphabetically with a deterministic tiebreaker

#### Scenario: Alphabetical order remains available and deterministic

- **WHEN** the request carries `sort=ALPHABETICAL`
- **THEN** rows order by product name under FI collation with a deterministic tiebreaker

#### Scenario: Unknown sort value is a contract error

- **WHEN** the request carries `sort=PROMOTED`
- **THEN** the API responds 400 with the unified error envelope and no results are computed

## ADDED Requirements

### Requirement: Catalog listing savings embed

`GET /api/v1/products` SHALL attach a display-only `savings` embed to every
listed item that has a savings-snapshot row for the latest materialized day,
carrying at least the landed total in cents, the Alko reference price in cents,
the gap in cents and basis points, the reliability label, and the confidence
label; the response SHALL carry the `savingsAsOf` day the embeds were read
from. The embed SHALL be composed at the worker-route display layer from the
savings-snapshot repository; items without a snapshot row SHALL omit the embed
entirely — no placeholder, no zero. The embed SHALL NOT feed any calculation,
ranking input, or basket optimization, and ordering by it SHALL remain a
display concern under the Server-side catalog sorting requirement.

#### Scenario: Covered item carries the embed

- **WHEN** a listed product has a snapshot row for the latest materialized day
- **THEN** its listing item carries the savings embed with landed total, Alko reference, gap, reliability, and confidence, and the response states the `savingsAsOf` day

#### Scenario: Uncovered item omits the embed

- **WHEN** a listed product has no snapshot row for the latest materialized day
- **THEN** its listing item carries no savings embed at all — no placeholder value and no zero

#### Scenario: Calculation output is identical with and without embeds

- **WHEN** the landed-cost calculation, the €/g ranking, or the basket optimization runs against data with zero and with many snapshot rows
- **THEN** each surface's output is byte-identical in both states (the isolation claim is unchanged)

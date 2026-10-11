# historical-price-intelligence Specification

## MODIFIED Requirements

### Requirement: Historical data API

The system SHALL expose `GET /api/v1/products/:id/price-history` accepting metric (price or landed-cost), granularity (day or week), a from/to date range capped at 365 days, an optional merchant filter, and an optional `attribution` query parameter (`auto` or `none`, defaulting to `auto`). The response SHALL include the series points from summaries, per-point reliability, the earliest available observation date, and — when attribution is `auto` — attribution for changes. The earliest available observation date SHALL derive from the materialized summary rows (the product's first daily bucket), carrying calendar-day precision. When `attribution=none`, the response SHALL carry an empty attribution list and the endpoint SHALL NOT read the raw observation log. The endpoint SHALL be rate-limited and gated behind the `enable_historical_price_intelligence` feature flag.

#### Scenario: Valid series request

- **WHEN** a client requests the landed-cost history for a product at daily granularity for a valid range
- **THEN** the system SHALL return the summary points with reliability metadata, the earliest available date, and change attributions

#### Scenario: Attribution opt-out skips the raw log

- **WHEN** a client requests the history with `attribution=none`
- **THEN** the response carries an empty attribution list with the series otherwise identical
- **AND** the endpoint performs no reads against the raw observation log

#### Scenario: Earliest date from summaries

- **WHEN** the endpoint resolves `earliestAvailableObservationDate`
- **THEN** the value is the start of the product's earliest materialized daily bucket, rendered as that calendar date

#### Scenario: Range cap enforced

- **WHEN** a client requests a range longer than 365 days
- **THEN** the system SHALL reject the request with a validation error

#### Scenario: Flag off blocks access

- **WHEN** the `enable_historical_price_intelligence` flag is disabled
- **THEN** the endpoint SHALL not serve historical data

## ADDED Requirements

### Requirement: Request path aggregates only

The price-history request path SHALL serve series and the earliest available observation date exclusively from materialized summary rows. Raw observation-log reads SHALL occur only when attribution is requested (`attribution=auto`), SHALL be bounded to partitions overlapping the requested range, and SHALL execute with bounded concurrency rather than one sequential read per partition. The product page's server-side history read SHALL request `attribution=none`.

#### Scenario: Product page render never touches the raw log

- **WHEN** a visitor loads a product page and the server fetches the history section
- **THEN** the request carries `attribution=none` and no observation-log partition is read

#### Scenario: Attribution reads stay in range

- **WHEN** a client requests history with `attribution=auto` for a bounded range
- **THEN** only partitions overlapping the range are read, concurrently within a fixed concurrency bound

#### Scenario: Log growth does not slow the endpoint

- **WHEN** the observation log accumulates additional day-partitions outside the requested range
- **THEN** the endpoint's latency is unaffected by the partitions it does not read

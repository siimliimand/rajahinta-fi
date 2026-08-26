# historical-price-intelligence Specification

## Purpose
TBD - created by archiving change 2026-08-26-phase2-historical-price-intelligence. Update Purpose after archive.
## Requirements
### Requirement: Append-only observation log

The system SHALL persist one `price_observations` row per observation of a merchant offer, recording the foreign retail price, the transport cost used, the excise and container-duty rule versions applicable at the observation timestamp, the resulting quantity=1 baseline landed cost, and the reliability status of each input. Observation rows SHALL never be updated or deleted by application code.

#### Scenario: Observation appended on ingestion

- **WHEN** the price-ingestion background job records a new or changed retail offer
- **THEN** the system SHALL append one observation row with price, transport cost, applicable tax-rule version references, landed cost, and per-input reliability statuses
- **AND** the row SHALL NOT be mutated afterward

#### Scenario: Observation never on the request path

- **WHEN** a user performs a landed-cost calculation
- **THEN** the system SHALL NOT append observations as a side effect of the request

### Requirement: Reuse of calculator engines

The landed cost stored in an observation SHALL be computed by the same tax and transport engine code paths as the user-facing Landed-Cost Calculator, such that an observation and a calculator run with identical inputs never produce different figures.

#### Scenario: Consistent with calculator

- **WHEN** an observation is recorded for a product at quantity=1 with a given offer and transport assumption
- **THEN** the landed-cost components SHALL equal those the calculator produces for the same inputs and tax-dataset version

### Requirement: Materialized aggregates

The system SHALL materialize daily and weekly summary rows per product (and per merchant offer) from the observation log, containing open, close, minimum, maximum, and average values for price and landed cost, plus the observation count and the strictest source reliability. Materialization SHALL run as a background job, SHALL be incremental from the last processed watermark, and SHALL be idempotent under job retries.

#### Scenario: Aggregates produced incrementally

- **WHEN** the scheduled time-series aggregation job runs after new observations were appended
- **THEN** the system SHALL upsert summary rows for the affected periods without recomputing unaffected history

#### Scenario: Retry safety

- **WHEN** the aggregation job runs twice for the same bucket
- **THEN** the summary rows for that bucket SHALL remain correct (idempotent upsert)

#### Scenario: Charts never recompute raw history

- **WHEN** a chart requests a historical series
- **THEN** the system SHALL serve it from materialized summaries, not by scanning and aggregating raw observations on the request path

### Requirement: Tax-change attribution

The system SHALL classify changes in the landed-cost series by joining consecutive observations against tax-rule effective windows, labeling each change as TAX_RULE_CHANGE, MERCHANT_PRICE_CHANGE, TRANSPORT_CHANGE, or MIXED, with evidence naming the inputs that moved and the rule versions bounding the step. Classification SHALL be computed from immutable stored inputs, never from mutable state.

#### Scenario: Tax-driven change identified

- **WHEN** the landed cost changes across consecutive observations while the merchant retail price is unchanged and a tax-rule version boundary falls within the step
- **THEN** the change SHALL be labeled TAX_RULE_CHANGE with the version labels bounding the step

#### Scenario: Merchant-driven change identified

- **WHEN** the retail price changes across consecutive observations while the applicable tax-rule versions are unchanged
- **THEN** the change SHALL be labeled MERCHANT_PRICE_CHANGE

#### Scenario: Simultaneous changes labeled honestly

- **WHEN** retail price and a tax-rule version change within the same step
- **THEN** the change SHALL be labeled MIXED with evidence listing both movements

### Requirement: Historical data API

The system SHALL expose `GET /api/v1/products/:id/price-history` accepting metric (price or landed-cost), granularity (day or week), a from/to date range capped at 365 days, and an optional merchant filter. The response SHALL include the series points from summaries, per-point reliability, the earliest available observation date, and attribution for changes. The endpoint SHALL be rate-limited and gated behind the `enable_historical_price_intelligence` feature flag.

#### Scenario: Valid series request

- **WHEN** a client requests the landed-cost history for a product at daily granularity for a valid range
- **THEN** the system SHALL return the summary points with reliability metadata, the earliest available date, and change attributions

#### Scenario: Range cap enforced

- **WHEN** a client requests a range longer than 365 days
- **THEN** the system SHALL reject the request with a validation error

#### Scenario: Flag off blocks access

- **WHEN** the `enable_historical_price_intelligence` flag is disabled
- **THEN** the endpoint SHALL not serve historical data

### Requirement: Data freshness surfaced

Every historical series served to a user SHALL carry the reliability status and timestamp provenance of its source observations, following the architecture rule that every externally sourced fact carries a reliability status and timestamp.

#### Scenario: Freshness on chart data

- **WHEN** a historical series point derives from STALE observations
- **THEN** the API response and the chart SHALL surface the STALE reliability status for that point


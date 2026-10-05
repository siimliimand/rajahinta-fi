# historical-price-intelligence Delta

## MODIFIED Requirements

### Requirement: Materialized aggregates

The system SHALL materialize daily and weekly summary rows per product (and per merchant offer) from the observation log, containing open, close, minimum, maximum, and average values for price and landed cost, plus the observation count and the strictest source reliability. Materialization SHALL run as a background job, SHALL be incremental from the last processed watermark, SHALL be idempotent under job retries, and SHALL satisfy the coverage invariant: after a successful pass, every product with at least one observation inside the processed range SHALL have at least one summary bucket. A documented backfill procedure (lowering the watermark to re-scan, then restoring it) SHALL close coverage gaps without ever aggregating on the request path.

#### Scenario: Aggregates produced incrementally

- **WHEN** the scheduled time-series aggregation job runs after new observations were appended
- **THEN** the system SHALL upsert summary rows for the affected periods without recomputing unaffected history

#### Scenario: Retry safety

- **WHEN** the aggregation job runs twice for the same bucket
- **THEN** the summary rows for that bucket SHALL remain correct (idempotent upsert)

#### Scenario: Charts never recompute raw history

- **WHEN** a chart requests a historical series
- **THEN** the system SHALL serve it from materialized summaries, not by scanning and aggregating raw observations on the request path

#### Scenario: Coverage invariant holds after a pass

- **WHEN** the aggregation processes a range containing observations for a product
- **THEN** that product has at least one summary bucket covering those observations, and a coverage check (products with observations but zero summary rows) answers zero

#### Scenario: Backfill closes gaps without touching the request path

- **WHEN** products exist with observations but missing summary buckets
- **THEN** the documented backfill procedure (watermark lowered, aggregation re-run idempotently, watermark restored) fills the missing buckets, and the historical endpoints begin serving their series without any change to the request path

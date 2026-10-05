# historical-price-intelligence Delta

## MODIFIED Requirements

### Requirement: Materialized aggregates

The system SHALL materialize daily and weekly summary rows per product (and per merchant offer) from the observation log, containing open, close, minimum, maximum, and average values for price and landed cost, plus the observation count and the strictest source reliability. Materialization SHALL run as a background job, SHALL be incremental from the last processed watermark, SHALL be idempotent under job retries, SHALL make bounded, resumable progress per invocation (cursor-scoped product slice, write-then-advance, within the per-invocation D1 statement budget), and SHALL satisfy the coverage invariant: at pass-sequence completion (cursor wraps), every product with at least one observation inside the processed range SHALL have at least one summary bucket. A documented backfill procedure SHALL close coverage gaps without ever aggregating on the request path: the initial gap-filling converges through scheduled ticks alone, and targeted re-scans lower the watermark to re-scan, then restore it.

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

- **WHEN** the aggregation's cursor-chunked pass sequence over a range containing observations for a product completes (cursor wraps)
- **THEN** that product has at least one summary bucket covering those observations, a coverage check (products with observations but zero summary rows) answers zero, and the watermark is written at the activity high water

#### Scenario: Backfill closes gaps without touching the request path

- **WHEN** products exist with observations but missing summary buckets
- **THEN** the documented backfill procedure fills the missing buckets — the initial gap-filling converges through scheduled ticks alone (cursor-chunked passes), and targeted re-scans lower the watermark, re-run idempotently through ticks, and restore it — and the historical endpoints serve their series without any change to the request path

#### Scenario: Bounded progress per invocation

- **WHEN** a scheduled tick processes a slice of an unfinished pass
- **THEN** the invocation persists that slice's summaries and advances the persisted cursor only after the writes succeed, and no invocation exceeds the per-invocation D1 statement budget

#### Scenario: Killed invocation resumes without losing ground

- **WHEN** an invocation is terminated mid-pass (budget exceeded)
- **THEN** the next tick resumes from the persisted cursor, re-doing at most the interrupted product's own idempotent upserts, and the pass sequence still converges

#### Scenario: Initial backfill converges through ticks alone

- **WHEN** products exist with observations but no summary buckets and no watermark has ever been written
- **THEN** successive scheduled ticks fill the missing buckets chunk by chunk until the coverage check answers zero, without any request-path aggregation and without a manual watermark edit

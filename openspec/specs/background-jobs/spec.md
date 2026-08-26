# background-jobs Specification

## Purpose
TBD - created by archiving change 2026-08-26-phase2-historical-price-intelligence. Update Purpose after archive.
## Requirements
### Requirement: Time-series aggregation worker materializes summaries

The `TimeSeriesAggregationWorker` SHALL consume the scheduled bucket job, read observations appended since the last processed watermark, upsert daily and weekly summary rows through the summary repository, and advance the watermark only after a successful upsert. Failures SHALL leave the watermark unchanged so the next run reprocesses the same window.

#### Scenario: First run after deployment

- **WHEN** the worker runs and no watermark exists
- **THEN** the worker SHALL process from the earliest unprocessed observation or a configured start boundary, and establish the watermark

#### Scenario: Failure preserves watermark

- **WHEN** a summary upsert fails mid-run
- **THEN** the watermark SHALL NOT advance past the failed period, and the retried run SHALL reprocess it idempotently

#### Scenario: No new observations

- **WHEN** the worker runs and no observations were appended since the watermark
- **THEN** the run SHALL complete without writes


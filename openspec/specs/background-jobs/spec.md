# background-jobs Specification

## Purpose
TBD - created by archiving change 2026-08-26-phase2-historical-price-intelligence. Update Purpose after archive.
## Requirements
### Requirement: Time-series aggregation worker materializes summaries

Time-series aggregation SHALL run as a scheduled Cron Trigger in the API Worker. It SHALL scan `priceObservations` past the aggregation watermark, materialize the same summary rows as today, and advance the watermark idempotently. A failed run SHALL leave the watermark unchanged so the next run redoes the window.

#### Scenario: Aggregation survives restart

- **WHEN** an aggregation run fails partway
- **THEN** the watermark is not advanced and the next scheduled run reprocesses the same window
### Requirement: Per-merchant ingestion scheduling

Ingestion scheduling SHALL be driven by the database-backed merchant registry: a scheduled producer enqueues one Cloudflare Queue message per permitted merchant with per-merchant dedupe keys (`price-ingestion-<merchantId>-<hour>`), and the consumer SHALL skip work whose dedupe key was already processed. Onboarding a merchant SHALL NOT require a deploy, and governance gating SHALL remain enforced before any fetch or persistence.

#### Scenario: Duplicate schedule produces one ingestion

- **WHEN** the producer enqueues the same merchant for the same hour twice
- **THEN** the consumer processes the ingestion exactly once

#### Scenario: New merchant requires no deploy

- **WHEN** a merchant is granted in the registry
- **THEN** the next scheduling run enqueues its ingestion without any code change
### Requirement: Transport freshness alerting job support

Transport-rate freshness monitoring SHALL run as a scheduled Cron Trigger that evaluates the freshness invariant and triggers the operational alert through the email Worker.

#### Scenario: Transport data goes stale

- **WHEN** transport offers exceed the freshness threshold
- **THEN** an alert email is triggered via the email Worker
### Requirement: Calculation record retention job

Retention SHALL run as a scheduled Cron Trigger that batch-deletes anonymous-session calculation records past the configured window (30 days) from D1, in bounded batches so no single run exceeds statement limits. The behavior, window, and audit trail SHALL match the current retention semantics.

#### Scenario: Retention prunes in bounded batches

- **WHEN** retention runs with more rows past the window than one batch allows
- **THEN** it deletes in multiple bounded batches and completes without statement-limit failures

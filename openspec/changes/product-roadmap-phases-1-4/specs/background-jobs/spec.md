# background-jobs Specification

## ADDED Requirements

### Requirement: Price-alert evaluation job

A scheduled job SHALL evaluate active price alerts after ingestion cycles. The job SHALL read only materialized summaries and alert state, SHALL be idempotent under retries (a re-run produces no duplicate notifications), SHALL record evaluated, matched, notified, and failure counters through the observability module, and SHALL never run on the user-facing request path.

#### Scenario: Idempotent re-run

- **WHEN** the evaluation job runs twice over the same data
- **THEN** alerts already notified within their cooldown SHALL produce no additional sends and counters SHALL remain consistent

#### Scenario: Failure visibility

- **WHEN** email delivery fails for one alert
- **THEN** the failure SHALL be counted and surfaced through the observability metrics without blocking evaluation of other alerts

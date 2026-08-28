# background-jobs Specification Delta

## ADDED Requirements

### Requirement: Per-merchant ingestion scheduling

The scheduler SHALL enqueue one ingestion job per permitted merchant from the merchant registry, each with a per-merchant dedupe key, enabling per-merchant backoff and monitoring. Catch-all wildcard jobs SHALL NOT be enqueued.

#### Scenario: One job per merchant

- **WHEN** the hourly schedule fires with three permitted merchants in the registry
- **THEN** three jobs SHALL be enqueued, each deduped by its own merchant key

#### Scenario: Slow feed does not delay others

- **WHEN** one merchant feed is slow
- **THEN** the other merchants' jobs SHALL run independently

### Requirement: Transport freshness alerting job support

The job infrastructure SHALL feed the transport-offer age into the freshness alerting path such that a newest-offer age beyond the 7-day threshold raises the configured alert.

#### Scenario: Aging transport raises alert

- **WHEN** the transport refresh completes with all offers older than 7 days
- **THEN** the freshness alert SHALL be in firing state

### Requirement: Calculation record retention job

A scheduled job SHALL prune monthly partitions of calculation records for anonymous sessions older than the configured retention window.

#### Scenario: Retention job prunes

- **WHEN** the retention job runs
- **THEN** anonymous-session partitions past the window SHALL be dropped and the run SHALL be recorded

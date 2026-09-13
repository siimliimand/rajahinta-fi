# data-acquisition Specification

## MODIFIED Requirements

### Requirement: Permitted-source ingestion

The pipeline SHALL ingest only merchants with `GRANTED` governance status. The adapter registry SHALL contain two live feed adapters: the Alko domestic reference feed and the alks.fi WooCommerce Store API feed. The alks.fi merchant SHALL be registered in the merchant registry (feedUrl `https://alks.fi`, json, daily cadence) with its governance source recorded as `RETAILER_API`, and SHALL NOT be fetched until an operator grants it through the governance gate. The Alko adapter's behavior SHALL remain unchanged.

#### Scenario: Registry holds both live merchants

- **WHEN** the ingestion scheduler enumerates permitted merchants
- **THEN** `alko` and `alks` are the registry rows, each resolved to its own adapter through the `FEED_ADAPTERS` map

#### Scenario: Ungranted alks is skipped

- **WHEN** the alks source has no `GRANTED` governance record
- **THEN** the pipeline performs no fetch for it and persists no data

### Requirement: Database-backed merchant registry

Merchant configuration SHALL live in a database-backed registry aligned with the governance records, replacing static configuration files. Onboarding, changing, or re-cadencing a permitted merchant SHALL NOT require a deployment: the scheduler SHALL honor each merchant's registry `polling_interval_ms` as its scrape interval. The hourly scheduling tick SHALL remain; a merchant SHALL be enqueued on a tick only when an interval boundary was crossed since the previous tick. Intervals below one hour SHALL NOT be schedulable (the tick cannot honor them). Existing hourly-interval merchants SHALL keep their current behavior.

#### Scenario: Registry-driven source list

- **WHEN** the ingestion pipeline enumerates merchant sources
- **THEN** the list SHALL come from the registry joined with governance permission state

#### Scenario: Daily merchant fires once per day

- **WHEN** a merchant's registry interval is 86,400,000 ms and the hourly tick runs through a full day
- **THEN** exactly one ingestion message is enqueued for that merchant, at the first tick after the 24-hour bucket boundary

#### Scenario: Hourly merchant unchanged

- **WHEN** a merchant's registry interval is 3,600,000 ms
- **THEN** the merchant is enqueued on every hourly tick exactly as before the gate existed

#### Scenario: Missed tick self-heals

- **WHEN** the tick that would cross an interval boundary fails to run
- **THEN** the next successful tick enqueues the merchant once, and the hourly dedupe key prevents duplication

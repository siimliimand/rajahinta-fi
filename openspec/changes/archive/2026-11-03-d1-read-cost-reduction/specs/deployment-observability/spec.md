# deployment-observability delta

## MODIFIED Requirements

### Requirement: Catalog data-quality metrics and alerting

The observability stack SHALL expose a data-quality panel covering: zero-price rejections from ingestion, implausible-volume share, Alko reference coverage (share of products with a usable reference offer), transport-row count per carrier, and per-feed last-success age. Threshold alerts SHALL fire on regression (new zero-price rejections, coverage drop to or near zero, empty transport table, stale feed) so data-quality regressions page before customers encounter them. Gauge figures SHALL be derived from materialized stores rather than whole-table scans of `retail_offers`: per-feed last-success age and the stale-price share read `merchant_reliability_aggregates`, and the bounded coverage pair rides an `observed_at` index range scan. Because cron handlers execute concurrently, gauge figures MAY lag the aggregates refresh by one tick.

#### Scenario: Empty reference coverage is alerted, not discovered

- **WHEN** Alko reference coverage falls to zero while the savings surface is enabled
- **THEN** an alert fires on the data-quality panel

#### Scenario: Transport dataset state is visible

- **WHEN** the transport offer table carries no rows for a carrier
- **THEN** the panel shows the carrier's row count as zero and the staleness alert covers it

#### Scenario: Gauge reads are bounded, never full scans

- **WHEN** any data-quality gauge statement is explained against migrated schema
- **THEN** no gauge scans `retail_offers` without an `observed_at` index range bound, and the per-feed last-success gauge reads only `merchant_reliability_aggregates`

#### Scenario: Gauge staleness tolerates one concurrent tick

- **WHEN** the aggregates refresh and the gauge pass execute on the same six-hourly tick
- **THEN** the gauges MAY report the prior tick's materialized figures without failing, and the lag is documented rather than alerted

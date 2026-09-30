# deployment-observability Specification

## ADDED Requirements

### Requirement: Catalog data-quality metrics and alerting

The observability stack SHALL expose a data-quality panel covering: zero-price rejections from ingestion, implausible-volume share, Alko reference coverage (share of products with a usable reference offer), transport-row count per carrier, and per-feed last-success age. Threshold alerts SHALL fire on regression (new zero-price rejections, coverage drop to or near zero, empty transport table, stale feed) so data-quality regressions page before customers encounter them.

#### Scenario: Empty reference coverage is alerted, not discovered

- **WHEN** Alko reference coverage falls to zero while the savings surface is enabled
- **THEN** an alert fires on the data-quality panel

#### Scenario: Transport dataset state is visible

- **WHEN** the transport offer table carries no rows for a carrier
- **THEN** the panel shows the carrier's row count as zero and the staleness alert covers it

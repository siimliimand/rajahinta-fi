# product-data-model Specification Delta

## ADDED Requirements

### Requirement: Price observations as a TimescaleDB hypertable

`price_observations` SHALL be converted to a TimescaleDB hypertable with the TimescaleDB extension enabled in migrations and the compose file. Aggregation and watermark scans SHALL continue to work with unchanged semantics on the hypertable.

#### Scenario: Extension present

- **WHEN** the database is provisioned through migrations
- **THEN** the TimescaleDB extension SHALL be installed and `price_observations` SHALL be registered as a hypertable

#### Scenario: Watermark scan unchanged

- **WHEN** the aggregation job scans for observations past the watermark
- **THEN** results SHALL be identical to the pre-conversion behavior

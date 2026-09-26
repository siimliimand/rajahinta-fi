# product-data-model Specification

## ADDED Requirements

### Requirement: Canonical unit volume

`product_master.unit_volume` SHALL store the per-unit beverage volume in **litres** as a positive real number. Every write path (ingestion mapper, seed pipeline, ETL) SHALL convert from source units (feed millilitres) at write time. The stored value SHALL satisfy `0 < unit_volume < 100`; rows outside that window are data errors and SHALL be rejected by the data-quality invariant, never interpreted with a second unit convention.

#### Scenario: Feed millilitres are converted at mapping

- **WHEN** a feed record carries `volumeMl = 500`
- **THEN** the mapped product input carries `unitVolume = "0.5"`

#### Scenario: Backfilled rows are litre-denominated

- **WHEN** the backfill pass runs over rows with `unit_volume >= 5`
- **THEN** each such row is divided by 1000 and the pass records before/after counts

#### Scenario: Unit-window invariant rejects implausible rows

- **WHEN** an ingestion quality check or data-quality test evaluates a row with `unit_volume >= 100` or `unit_volume <= 0`
- **THEN** the row is flagged as a data error and the check fails

#### Scenario: Reseeding cannot reintroduce millilitres

- **WHEN** the local seed pipeline regenerates D1 content from its sources
- **THEN** every `product_master.unit_volume` value it writes is litre-denominated

# savings-discovery Specification

## MODIFIED Requirements

### Requirement: Daily materialized landed-cost gap listing

The system SHALL maintain a daily materialized snapshot, keyed by as-of date and product, of the landed-cost gap between each qualifying product's complete landed cost (computed by the landed-cost calculator for quantity 1, destination Finland, default transport arrangement) and its Alko domestic reference price. A product qualifies when it carries an Alko reference offer with an observation timestamp on its own product record, OR when a CONFIRMED product reference link connects its product record to a distinct Alko product record — in the linked case, the landed cost SHALL be computed on the qualifying product's own best offer and the reference SHALL be resolved from the linked Alko product's Alko offers using the same benchmark selection the calculator applies (newest observation, ties to the higher offer id). A product without a usable benchmark produces no row: absence is the honest state, a guessed gap never materializes. Every snapshot row SHALL carry the landed total, the Alko reference, the gap in euro cents and basis points, the reliability status, the confidence grade, the tax dataset version that produced the figures, and — when a confirmed link produced the pair — the reference link id. The snapshot pass SHALL run in a scheduled background job off the request path, SHALL be idempotent per as-of date, and SHALL isolate per-product failures so one product's error does not drop the run. Only links in CONFIRMED status SHALL be read; PENDING and REJECTED links SHALL have no effect on any snapshot row.

#### Scenario: Gap materialized for qualifying product

- **WHEN** a product carries an Alko reference offer with an observation timestamp
- **THEN** a snapshot row SHALL exist for the as-of date with the landed total, reference, gap in cents and basis points, reliability, confidence, and tax dataset version

#### Scenario: Linked foreign product materialized against its reference

- **WHEN** a foreign product has a CONFIRMED reference link to an Alko product, and its own best offer carries a usable landed-cost computation
- **THEN** a snapshot row SHALL exist whose landed total derives from the foreign product's offer and whose Alko reference derives from the linked Alko product's offers, with the reference link id recorded on the row

#### Scenario: Unconfirmed links are inert

- **WHEN** a reference link exists in PENDING or REJECTED status
- **THEN** no snapshot row is produced because of it and the savings surface is unchanged

#### Scenario: Non-qualifying product omitted

- **WHEN** a product has neither a direct Alko reference offer nor a CONFIRMED link
- **THEN** no snapshot row SHALL be produced for it rather than a guessed gap

#### Scenario: Re-run is idempotent

- **WHEN** the snapshot pass runs twice for the same as-of date
- **THEN** the second run SHALL overwrite the same keyed rows without duplicating them

#### Scenario: Per-product failure isolated

- **WHEN** one product's evaluation throws during the pass
- **THEN** the remaining products SHALL still materialize and the failure SHALL be logged

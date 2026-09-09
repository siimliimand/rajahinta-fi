# savings-discovery Specification

## Purpose
TBD - created by archiving change insight-surfaces. Update Purpose after archive.
## Requirements
### Requirement: Daily materialized landed-cost gap listing

The system SHALL maintain a daily materialized snapshot, keyed by as-of date and product, of the landed-cost gap between each qualifying product's complete landed cost (computed by the landed-cost calculator for quantity 1, destination Finland, default transport arrangement) and its Alko domestic reference price. A product qualifies only when it carries an Alko reference offer with an observation timestamp. Every snapshot row SHALL carry the landed total, the Alko reference, the gap in euro cents and basis points, the reliability status, the confidence grade, and the tax dataset version that produced the figures. The snapshot pass SHALL run in a scheduled background job off the request path, SHALL be idempotent per as-of date, and SHALL isolate per-product failures so one product's error does not drop the run.

#### Scenario: Gap materialized for qualifying product

- **WHEN** the daily pass runs and a product carries an Alko reference offer with an observation timestamp
- **THEN** a snapshot row SHALL exist for the as-of date with the landed total, reference, gap in cents and basis points, reliability, confidence, and tax dataset version

#### Scenario: Non-qualifying product omitted

- **WHEN** a product has no Alko reference offer, or its reference lacks an observation timestamp
- **THEN** no snapshot row SHALL be produced for it rather than a guessed gap

#### Scenario: Re-run is idempotent

- **WHEN** the pass runs twice for the same as-of date
- **THEN** the second run SHALL overwrite the same keyed rows without duplicating them

#### Scenario: Per-product failure isolated

- **WHEN** the calculator fails for one product during the pass
- **THEN** the remaining products SHALL still materialize and the failure SHALL be logged

### Requirement: Public deterministic savings listing

A public API endpoint SHALL return the latest snapshot rows for one category, ordered deterministically by gap basis points descending with product name ascending as the tiebreaker. The response SHALL include the as-of date and coverage counts (products evaluated, products with a reference, rows listed), and each row SHALL carry its reliability status and confidence. Rows with unavailable landed figures SHALL be omitted rather than guessed into a position. The endpoint SHALL be age-gated and rate-limited.

#### Scenario: Deterministic order

- **WHEN** the listing is requested twice for the same category and snapshot day
- **THEN** the rows and their order SHALL be identical, with equal gaps broken by product name

#### Scenario: Coverage and as-of always present

- **WHEN** any listing response is returned
- **THEN** it SHALL carry the as-of date and the three coverage counts

#### Scenario: Honest zero state

- **WHEN** no snapshot rows exist for the requested category
- **THEN** the endpoint SHALL return an empty list with the coverage counts instead of an error

### Requirement: Savings page is informational and display-only

The `/savings` page SHALL render the listing with factual comparative copy only, showing each row's landed total, Alko reference, gap, reliability badge, and the as-of date and coverage counts. The page SHALL state its ordering rule and SHALL NOT contain advice, recommendation, or marketing phrasing. Savings data SHALL NOT feed the calculator, ranking, basket optimization, or any other computed ordering; a compliance test SHALL prove those outputs byte-identical with zero, one, and many savings snapshots present.

#### Scenario: Page renders facts with provenance

- **WHEN** a visitor opens `/savings` for a category with data
- **THEN** each row SHALL show its landed total, reference, gap, reliability badge, and the page SHALL show the as-of date and coverage counts

#### Scenario: Savings data isolated from computations

- **WHEN** savings snapshots exist for any number of products
- **THEN** calculator, ranking, and basket outputs SHALL be byte-identical to outputs produced with no snapshots present


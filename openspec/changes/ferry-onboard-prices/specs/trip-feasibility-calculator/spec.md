# trip-feasibility-calculator Delta

## ADDED Requirements

### Requirement: Observed onboard prices block

The trip fill and feasibility responses SHALL return observed ferry onboard-shop prices as a separate additive block (`ferryPrices`), each row carrying operator, route, display label, EUR price, observed-at date, and a source citation. Rows SHALL originate only from the curated ferry price dataset published through the governance gate. The block SHALL have zero influence on calculation inputs, computation, ordering, or any other response field, and a compliance test SHALL verify that all calculation output is identical with and without price rows present. Absent or stale published rows SHALL render no block rather than old figures.

#### Scenario: Observed prices render with provenance

- **WHEN** the trip result contains published `ferryPrices` rows
- **THEN** each row displays operator, route, label, price, the observation date, and its citation, labeled as observed facts rather than offers

#### Scenario: Calculation is byte-identical with and without price rows

- **WHEN** the same trip request is answered with zero, one, and many `ferryPrices` rows present
- **THEN** every calculation-bearing field of the response is byte-identical across the three cases

#### Scenario: Empty state renders nothing

- **WHEN** no published ferry price rows exist for the response
- **THEN** the frontend renders no onboard-price block, and no fallback or guessed figures appear

#### Scenario: Block respects the existing guard chain

- **WHEN** the trip fill endpoint serves a response containing `ferryPrices`
- **THEN** the endpoint's age gate, rate-limit profile, idempotency keying, and anonymity behavior are unchanged

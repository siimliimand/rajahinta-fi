# calculation-outcomes Delta

## ADDED Requirements

### Requirement: Persisted empirical margins

The outcome aggregation job SHALL compute and persist per-cell empirical
margins (cell key, ladder dimension, quantile, sample count, as-of) alongside
its existing aggregations, and SHALL persist no rows when no outcome reports
exist. The margins SHALL be recomputed from stored outcome reports only.

#### Scenario: Aggregation writes margins

- **WHEN** the aggregation job runs over non-empty outcome reports
- **THEN** per-cell margins with sample counts and as-of are persisted

#### Scenario: Empty input persists nothing

- **WHEN** no outcome reports exist
- **THEN** the margins store holds no rows and no synthesized values

### Requirement: Margins read endpoint

A public read endpoint SHALL expose the persisted margin ladder (cells with
quantile, sample count, as-of) and SHALL present an honest empty state when no
margins exist. The endpoint SHALL NOT synthesize margins from partial data.

#### Scenario: Honest empty state

- **WHEN** the margins store is empty
- **THEN** the endpoint reports no margins rather than a default value

# calculation-outcomes Delta

## ADDED Requirements

### Requirement: Persisted empirical margins

The margin calibration SHALL run on the existing 30-minute aggregation tick
(the freshness-alert / savings-snapshots precedent — no dedicated cron) as an
error-isolated step, and SHALL recompute the per-cell empirical margins (cell
key, ladder dimension, quantile, sample count, as-of) from stored outcome
reports only, replacing the whole persisted ladder each run (delete-then-
insert in one batch, so a cell the corpus no longer calibrates disappears
with its reports). The step SHALL persist no rows when no outcome reports
exist or every cell is below the sample floor — no synthesized values.

#### Scenario: Aggregation tick writes margins

- **WHEN** the margin step runs on the aggregation tick over non-empty
  outcome reports
- **THEN** per-cell margins with sample counts and as-of are persisted,
  replacing the previous ladder

#### Scenario: Empty input persists nothing

- **WHEN** no outcome reports exist
- **THEN** the margins store holds no rows and no synthesized values

### Requirement: Margins read endpoint

The public margins endpoint SHALL serve the persisted margin ladder verbatim
— each cell with its ladder dimension, key, quantile, sample count, and
as-of, in ladder order — with a top-level as-of derived from the persisted
cells (the ladder's own run instant), and SHALL present the honest empty
state (`margins: [], asOf: null`) when no margins exist. The endpoint SHALL
NOT synthesize margins, cells, or timestamps from partial data or from the
clock.

#### Scenario: Honest empty state

- **WHEN** the margins store is empty
- **THEN** the endpoint returns an empty margin list with a null as-of rather
  than a default value or a fabricated instant

#### Scenario: Served verbatim from the snapshot

- **WHEN** the margins endpoint is requested after a refresh
- **THEN** every served cell equals its persisted row (dimension, key,
  quantile, sample count, as-of) and the top-level as-of is the ladder's own
  run instant, never the request time

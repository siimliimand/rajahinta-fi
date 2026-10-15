# merchant-reliability-scoring Specification

## ADDED Requirements

### Requirement: Index-bounded verified-ageing sweep

The periodic VERIFIED→STALE ageing sweep over `retail_offers` SHALL be served by the composite index `(reliability_status, observed_at)` such that its per-tick read cost scales with the offers that actually aged since the previous tick, not with catalog size or observation-history depth. The query plan SHALL use a `SEARCH` on that index (asserted by test), and a full table scan SHALL be treated as a regression.

#### Scenario: Sweep plan is index-bounded

- **WHEN** the ageing sweep statement is explained against migrated schema
- **THEN** the plan searches `retail_offers_reliability_status_observed_at_idx` rather than scanning the table

#### Scenario: Cost independent of history depth

- **WHEN** the observation history grows while the set of newly-aged VERIFIED offers stays small
- **THEN** the sweep's per-tick rows read stays proportional to the newly-aged set, not to total rows

# compliance-governance Specification

## ADDED Requirements

### Requirement: Domestic benchmark neutrality

The Alko benchmark SHALL be structurally excluded from commercial influence: it SHALL NOT be part of any ranking input type, SHALL NOT alter any sort order, and SHALL NOT modify calculation output other than its own display-only field. A compliance test SHALL pin result invariance across zero, one, and many reference rows, extending the existing neutrality suite.

#### Scenario: Ranking lockstep with benchmark

- **WHEN** the ranking lockstep suite runs over products with and without Alko reference offers
- **THEN** all sort orders are identical to the benchmark-free baseline, and the suite fails the build if the benchmark field reaches any ranking input

#### Scenario: Removed vocabulary stays removed

- **WHEN** the content vocabulary sweep runs over code, seeds, and message catalogs, excluding the archive
- **THEN** no non-historical reference to the removed Swedish merchant or SEK conversion exists

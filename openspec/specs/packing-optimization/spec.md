# packing-optimization Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Deterministic packing suggestion

Given a basket with known product dimensions, the system SHALL produce a packing suggestion using a deterministic first-fit-decreasing heuristic: items sorted by decreasing height then diameter, placed into the smallest carrier box from `carrierBoxTypes` that fits weight and volume, reporting box count, per-box grouping, and fill rate. The same input SHALL always produce the same suggestion.

#### Scenario: Same basket, same packing

- **WHEN** the packing module runs twice on an identical basket and box data
- **THEN** the box selection, grouping, and fill rate SHALL be identical

#### Scenario: Smallest sufficient box preferred

- **WHEN** multiple box types could hold the basket
- **THEN** the suggestion SHALL select the smallest box that satisfies weight and volume with the reported fill rate

### Requirement: Glass and metal mixing warning

The packing result SHALL include a warning when the basket mixes glass bottles and metal cans beyond defined thresholds (mixed-material unit count or combined weight). The warning SHALL state the observed figures and the threshold that triggered it.

#### Scenario: Mixed contents beyond threshold

- **WHEN** a basket combines glass and metal items exceeding a configured threshold
- **THEN** the result SHALL carry an explicit mixing warning citing the counts or weight involved

#### Scenario: Warning absent under thresholds

- **WHEN** mixed contents remain within thresholds
- **THEN** no mixing warning SHALL be attached

### Requirement: Missing dimensions degrade explicitly

Products without dimension rows SHALL be reported as ESTIMATED and excluded from breakage-risk reasoning, and the packing result SHALL name them. The system SHALL NOT estimate dimensions silently.

#### Scenario: Unknown dimensions listed

- **WHEN** a basket contains items without dimension rows
- **THEN** the packing result SHALL still pack the known items, SHALL mark the result ESTIMATED, and SHALL list the excluded items


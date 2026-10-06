# confidence-framework Delta

## ADDED Requirements

### Requirement: Empirical result margin

The framework SHALL derive an optional empirical margin for a landed-cost
result from user-reported calculation outcomes: the p80 quantile of relative
error `|reported_total − estimated_total| / estimated_total`, resolved through
a cell ladder (category×carrier → category → global) where the first rung with
at least 10 matching reports wins. The quantile comparison SHALL be inclusive.
When no rung meets the sample floor, the margin SHALL be null — the system
SHALL never fabricate or default a margin, and a null margin SHALL be
renderable as nothing.

#### Scenario: Ladder resolves at the deepest floored cell

- **WHEN** a result's category×carrier cell has 10 or more outcome reports
- **THEN** the margin comes from that cell's quantile, not a shallower rung

#### Scenario: Below the floor the margin is null

- **WHEN** every ladder rung for a result holds fewer than 10 reports
- **THEN** the margin is null and no numeric margin is rendered or implied

#### Scenario: The margin never enters computation

- **WHEN** a result carries a margin
- **THEN** every total, breakdown line, ranking position, and sort order is
  byte-identical to the same result without the margin

### Requirement: Margin UI presents its basis

Where a margin is displayed, the relative percent, the sample count, and the
as-of date SHALL be presented adjacent to the ± figure, and a link to the
methodology explanation SHALL be reachable from the meter.

#### Scenario: The basis travels with the figure

- **WHEN** a result renders a ± figure
- **THEN** the sample count and as-of date are visible next to it, and the
  methodology explanation is one click away

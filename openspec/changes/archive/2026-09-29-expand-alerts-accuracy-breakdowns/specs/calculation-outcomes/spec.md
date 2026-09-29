# calculation-outcomes Specification

## MODIFIED Requirements

### Requirement: Public accuracy statistic labeled user-reported

The public accuracy statistic SHALL remain computed read-time from stored outcomes, with `withinMarginShare` null exactly when the count is 0 and the count always displayed. The statistic SHALL additionally support read-time breakdowns by product category (outcome → calculation record → `product_master.category`, canonical set) and by transport carrier (calculation record → transport offer), each breakdown cell carrying its own count and within-margin share under the same honesty rules. A breakdown cell with fewer than 10 outcomes SHALL render the count only — a distinct count-only state, never a percentage. A cell with 0 outcomes SHALL render the honest empty state. All wording SHALL stay locked to the module labels ("user-reported"); the breakdown read path SHALL be display-only and SHALL NOT feed the calculator, ranking, or any basket input. The global statistic's shape and semantics SHALL be unchanged.

#### Scenario: Breakdown cell above the floor

- **WHEN** a category cell aggregates 10 or more outcomes
- **THEN** the cell renders its within-margin share and its count, labeled user-reported

#### Scenario: Breakdown cell below the floor is count-only

- **WHEN** a category or carrier cell aggregates between 1 and 9 outcomes
- **THEN** the cell renders the count only and no percentage

#### Scenario: Empty cell stays honest

- **WHEN** a breakdown dimension has no outcomes for a value
- **THEN** the cell renders the empty state (null share), never a fabricated 0% or 100%

#### Scenario: Global statistic unchanged

- **WHEN** the unfiltered accuracy statistic is requested
- **THEN** the response carries the same count, withinMarginShare, asOf, and module labels as before this change

#### Scenario: Breakdowns are display-only

- **WHEN** the breakdown endpoint and its frontend rendering are active
- **THEN** calculator, ranking, and basket responses remain byte-identical (compliance-pinned), and no breakdown value feeds any calculation input

# calculation-outcomes Specification

## Purpose

After a calculation, an authenticated user can report what the import actually cost, one report per record per account inside a 60-day window. The reported totals power a public aggregate accuracy statistic — the share of reported outcomes within 5% of the estimate, with sample size and as-of date — labeled user-reported everywhere. Outcome rows freeze the estimate they compare against and carry retention independent of the calculation-record sweep, so the accuracy evidence outlives the estimate record.

## Requirements

### Requirement: One user-reported outcome per calculation

An authenticated account SHALL be able to report the actual total cost of one of its own calculation records within 60 days of the record's calculation timestamp. The system SHALL accept at most one outcome per calculation record per account and SHALL store the reported total in euro cents alongside a digest of the original estimate.

#### Scenario: Outcome recorded

- **WHEN** an authenticated user reports the actual cost of their calculation within the window
- **THEN** the system SHALL store the outcome linked to the record and the account, and the record SHALL be marked as reported

#### Scenario: Duplicate rejected

- **WHEN** the same user reports a second outcome for the same record
- **THEN** the request SHALL be rejected with 409 and the stored outcome SHALL remain unchanged

#### Scenario: Window expired

- **WHEN** a report is attempted more than 60 days after the calculation timestamp
- **THEN** the request SHALL be rejected and no outcome SHALL be stored

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

### Requirement: Retention decoupled from calculation records

Outcome rows SHALL carry their own retention (24-month cap) enforced by a scheduled sweep, independent of the calculation-record age cap, so that reported outcomes are not silently destroyed by the estimate-record sweep.

#### Scenario: Estimate pruned, outcome retained

- **WHEN** the calculation-record retention job prunes a record older than the record cap
- **THEN** its outcome row SHALL remain, holding its snapshot of the estimate, until the outcome cap prunes it

### Requirement: Catalog coverage block on the accuracy response

The public accuracy response SHALL carry an additive `coverage` block computed read-time from stored catalog state: the distinct product count, the total offer observation count, and the last ingestion watermark timestamp. The block SHALL contain only true stored values — no estimates, no seeded counters. The user-reported statistic's shape and semantics SHALL be unchanged; the coverage block is additive and display-only, and SHALL NOT feed the calculator, ranking, or any basket input.

#### Scenario: Coverage block present and true

- **WHEN** the accuracy endpoint is requested with zero stored outcomes
- **THEN** the response carries `count: 0` exactly as before, plus the coverage block whose values equal the corresponding D1 counts and watermark

#### Scenario: Additive, display-only

- **WHEN** the coverage block is added to the response
- **THEN** calculator, ranking, and basket responses remain byte-identical (compliance-pinned), and no coverage value feeds any calculation input

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

The system SHALL expose a public aggregate statistic computed from stored outcomes: the number of reported outcomes, the share whose reported total fell within the configured margin (5%) of the estimate, and the as-of date. The API response and every UI rendering SHALL label the statistic as based on user-reported outcomes and SHALL display the sample size.

#### Scenario: Statistic reflects stored outcomes

- **WHEN** the accuracy endpoint is called
- **THEN** it SHALL return the count, the within-margin share, and the as-of date computed read-time from stored outcomes

#### Scenario: Empty state honest

- **WHEN** no outcomes exist yet
- **THEN** the statistic SHALL be returned with count zero and the UI SHALL state that no user-reported outcomes exist yet, not a percentage

### Requirement: Retention decoupled from calculation records

Outcome rows SHALL carry their own retention (24-month cap) enforced by a scheduled sweep, independent of the calculation-record age cap, so that reported outcomes are not silently destroyed by the estimate-record sweep.

#### Scenario: Estimate pruned, outcome retained

- **WHEN** the calculation-record retention job prunes a record older than the record cap
- **THEN** its outcome row SHALL remain, holding its snapshot of the estimate, until the outcome cap prunes it

# savings-discovery Specification

## MODIFIED Requirements

### Requirement: Public deterministic savings listing

A public API endpoint SHALL return the latest snapshot rows for one category, ordered deterministically by gap basis points ascending (the largest saving first) with product name ascending as the tiebreaker. The response SHALL include the as-of date and coverage counts (products evaluated, products with a reference, rows listed), and each row SHALL carry its reliability status and confidence. Rows with unavailable landed figures SHALL be omitted rather than guessed into a position. The endpoint SHALL be age-gated and rate-limited.

#### Scenario: Deterministic order

- **WHEN** the listing is requested twice for the same category and snapshot day
- **THEN** the rows and their order SHALL be identical, with the largest saving (the most negative gap) first and equal gaps broken by product name

#### Scenario: Coverage and as-of always present

- **WHEN** any listing response is returned
- **THEN** it SHALL carry the as-of date and the three coverage counts

#### Scenario: Honest zero state

- **WHEN** no snapshot rows exist for the requested category
- **THEN** the endpoint SHALL return an empty list with the coverage counts instead of an error

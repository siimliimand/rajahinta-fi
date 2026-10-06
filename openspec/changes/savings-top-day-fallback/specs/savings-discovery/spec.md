# savings-discovery Delta

## MODIFIED Requirements

### Requirement: Public deterministic cross-category top-N listing

A public API endpoint SHALL return the N rows (default five, clamped to
a fixed maximum) with the largest gaps among import-favourable rows —
rows whose computed gap against the Alko reference is negative — from
the single snapshot day selected as follows: the maximal snapshot day
when it contains at least one eligible row, otherwise the most recent
earlier snapshot day within a fixed 3-day lookback that does. The
selection SHALL apply the same sufficiency defenses as the per-category
listing: only rows with a computed Alko reference and a product name
the registry still resolves are eligible. When fewer than N eligible
rows exist on the selected day, the endpoint SHALL return those rows
without padding. The response SHALL include the selected day's as-of
date and coverage counts computed over that day, and each row SHALL
carry the product id and name, merchant, merchant country, observed
price, landed total, Alko reference, gap figures, and reliability
status and confidence. The endpoint SHALL be age-gated and
rate-limited like the per-category listing.

#### Scenario: Deterministic import-favourable order

- **WHEN** the top-N listing is requested twice on the same snapshot day
- **THEN** the rows and their order SHALL be identical, with the most import-favourable gap first and equal gaps broken by product id

#### Scenario: Eligibility matches the listing's defenses

- **WHEN** a snapshot row has a non-negative gap, lacks a computed Alko reference, or its product name no longer resolves from the registry
- **THEN** that row SHALL NOT appear in the top-N listing

#### Scenario: Fallback to the most recent day with eligible rows

- **WHEN** the maximal snapshot day contains no eligible row and an earlier day within the lookback does
- **THEN** the endpoint SHALL return that earlier day's eligible rows with that day's as-of date and coverage counts

#### Scenario: No padding beyond what qualifies

- **WHEN** fewer than N eligible import-favourable rows exist on the selected day
- **THEN** the endpoint SHALL return exactly those rows, never filled with dearer-than-reference rows

#### Scenario: Honest zero state within the lookback

- **WHEN** no snapshot day within the lookback contains an eligible row
- **THEN** the endpoint SHALL return an empty list with the maximal day's as-of date and zero eligible coverage instead of an error

# savings-discovery Delta

## ADDED Requirements

### Requirement: Public deterministic cross-category top-N listing

A public API endpoint SHALL return the N rows (default five, clamped to
a fixed maximum) with the largest gaps among import-favourable rows —
rows whose computed gap against the Alko reference is negative — from
the latest single-day snapshot across all categories, ordered by gap
basis points ascending with product id ascending as the final
tie-break. The selection SHALL apply the same sufficiency defenses as
the per-category listing: only rows with a computed Alko reference and
a product name the registry still resolves are eligible. When fewer
than N eligible import-favourable rows exist, the endpoint SHALL
return those rows without padding. The response SHALL include the
as-of date and coverage counts, and each row SHALL carry the product
id and name, merchant, merchant country, observed price, landed total,
Alko reference, gap figures, and reliability status and confidence.
The endpoint SHALL be age-gated and rate-limited like the per-category
listing.

#### Scenario: Deterministic import-favourable order

- **WHEN** the top-N listing is requested twice on the same snapshot day
- **THEN** the rows and their order SHALL be identical, with the most import-favourable gap first and equal gaps broken by product id

#### Scenario: Eligibility matches the listing's defenses

- **WHEN** a snapshot row has a non-negative gap, lacks a computed Alko reference, or its product name no longer resolves from the registry
- **THEN** that row SHALL NOT appear in the top-N listing

#### Scenario: No padding beyond what qualifies

- **WHEN** fewer than N eligible import-favourable rows exist on the latest snapshot day
- **THEN** the endpoint SHALL return exactly those rows, never filled with dearer-than-reference rows

#### Scenario: Honest zero state

- **WHEN** no eligible snapshot rows exist
- **THEN** the endpoint SHALL return an empty list with the as-of date and coverage counts instead of an error

## MODIFIED Requirements

### Requirement: Savings page is informational and display-only

The `/savings` page SHALL render the listing with factual comparative
copy only, showing each row's landed total, Alko reference, gap,
reliability badge, and the as-of date and coverage counts. Each
listing row SHALL link to that product's detail page; the link SHALL
NOT alter the row's figures or its position in the deterministic
order. The page SHALL state its ordering rule and SHALL NOT contain
advice, recommendation, or marketing phrasing. Savings data SHALL NOT
feed the calculator, ranking, basket optimization, or any other
computed ordering; a compliance test SHALL prove those outputs
byte-identical with zero, one, and many savings snapshots present.

#### Scenario: Page renders facts with provenance

- **WHEN** a visitor opens `/savings` for a category with data
- **THEN** each row SHALL show its landed total, reference, gap, reliability badge, and the page SHALL show the as-of date and coverage counts

#### Scenario: Listing rows link to product detail pages

- **WHEN** a listing row renders for a product
- **THEN** the row is a link to that product's detail page and its figures and position are identical to the unlinked form

#### Scenario: Savings data isolated from computations

- **WHEN** savings snapshots exist for any number of products
- **THEN** calculator, ranking, and basket outputs SHALL be byte-identical to outputs produced with no snapshots present

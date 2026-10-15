# savings-discovery Specification

## MODIFIED Requirements

### Requirement: Public deterministic savings listing

A public API endpoint SHALL return the latest snapshot rows for one category, ordered deterministically by gap basis points ascending with product name ascending as the tiebreaker, and SHALL list only rows with a negative gap (an import favourable against the Alko reference). A row whose offer is paired with the same merchant's Alko reference — a self-pairing that carries no cross-border comparison — SHALL be excluded. When the category has no negative-gap rows, the response SHALL carry empty rows, the coverage counts, and an explicit no-favourable-imports marker with the as-of date, instead of the least-negative positive-gap rows. The response SHALL include the as-of date and coverage counts (products evaluated, products with a reference, rows listed), and each row SHALL carry its reliability status and confidence. Rows with unavailable landed figures SHALL be omitted rather than guessed into a position. The endpoint SHALL be age-gated and rate-limited.

#### Scenario: Deterministic order

- **WHEN** the listing is requested twice for the same category and snapshot day
- **THEN** the rows and their order SHALL be identical, with the largest saving (the most negative gap) first and equal gaps broken by product name

#### Scenario: Coverage and as-of always present

- **WHEN** any listing response is returned
- **THEN** it SHALL carry the as-of date, the coverage counts, and the no-favourable-imports marker

#### Scenario: Honest zero state

- **WHEN** no negative-gap rows exist for the requested category
- **THEN** the endpoint SHALL return empty rows with the coverage counts and the no-favourable-imports marker instead of an error or positive-gap rows

#### Scenario: Loss rows never listed as savings

- **WHEN** a category's snapshot rows are all non-negative gaps
- **THEN** no positive-gap row appears in the listing

#### Scenario: Self-paired rows excluded

- **WHEN** a snapshot row pairs a merchant offer with the same merchant's Alko reference
- **THEN** the row SHALL NOT appear in the listing

### Requirement: Savings page is informational and display-only

The `/savings` page SHALL render the listing with factual comparative
copy only, showing each row's landed total, Alko reference, gap,
reliability badge, and the as-of date and coverage counts. Each
listing row SHALL link to that product's detail page; the link SHALL
NOT alter the row's figures or its position in the deterministic
order. When the category response carries the no-favourable-imports
marker, the page SHALL render an explicit no-favourable-imports state
showing the as-of date and coverage counts in place of a listing; the
ordering statement SHALL remain. The page SHALL state its ordering rule
and SHALL NOT contain advice, recommendation, or marketing phrasing.
Savings data SHALL NOT feed the calculator, ranking, basket
optimization, or any other computed ordering; a compliance test SHALL
prove those outputs byte-identical with zero, one, and many savings
snapshots present.

#### Scenario: Page renders facts with provenance

- **WHEN** a visitor opens `/savings` for a category with data
- **THEN** each row SHALL show its landed total, reference, gap, reliability badge, and the page SHALL show the as-of date and coverage counts

#### Scenario: Listing rows link to product detail pages

- **WHEN** a listing row renders for a product
- **THEN** the row is a link to that product's detail page and its figures and position are identical to the unlinked form

#### Scenario: Zero-negative category renders the honest state

- **WHEN** a visitor opens `/savings` for a category whose response carries the no-favourable-imports marker
- **THEN** the page renders the no-favourable-imports state with the as-of date and coverage counts, and no positive-gap row renders as a savings row

#### Scenario: Savings data isolated from computations

- **WHEN** savings snapshots exist for any number of products
- **THEN** calculator, ranking, and basket outputs SHALL be byte-identical to outputs produced with no snapshots present

# savings-discovery Specification

## Purpose
TBD - created by archiving change insight-surfaces. Update Purpose after archive.

## Requirements

### Requirement: Daily materialized landed-cost gap listing

The system SHALL maintain a daily materialized snapshot, keyed by as-of date and product, of the landed-cost gap between each qualifying product's complete landed cost (computed by the landed-cost calculator for quantity 1, destination Finland, default transport arrangement) and its Alko domestic reference price. A product qualifies when it carries an Alko reference offer with an observation timestamp on its own product record, OR when a CONFIRMED product reference link connects its product record to a distinct Alko product record — in the linked case, the landed cost SHALL be computed on the qualifying product's own best offer and the reference SHALL be resolved from the linked Alko product's Alko offers using the same benchmark selection the calculator applies (newest observation, ties to the higher offer id). A product without a usable benchmark produces no row: absence is the honest state, a guessed gap never materializes. Every snapshot row SHALL carry the landed total, the Alko reference, the gap in euro cents and basis points, the reliability status, the confidence grade, the tax dataset version that produced the figures, and — when a confirmed link produced the pair — the reference link id. The snapshot pass SHALL run in a scheduled background job off the request path, SHALL be idempotent per as-of date, and SHALL isolate per-product failures so one product's error does not drop the run. Only links in CONFIRMED status SHALL be read; PENDING and REJECTED links SHALL have no effect on any snapshot row.

#### Scenario: Gap materialized for qualifying product

- **WHEN** a product carries an Alko reference offer with an observation timestamp
- **THEN** a snapshot row SHALL exist for the as-of date with the landed total, reference, gap in cents and basis points, reliability, confidence, and tax dataset version

#### Scenario: Linked foreign product materialized against its reference

- **WHEN** a foreign product has a CONFIRMED reference link to an Alko product, and its own best offer carries a usable landed-cost computation
- **THEN** a snapshot row SHALL exist whose landed total derives from the foreign product's offer and whose Alko reference derives from the linked Alko product's offers, with the reference link id recorded on the row

#### Scenario: Unconfirmed links are inert

- **WHEN** a reference link exists in PENDING or REJECTED status
- **THEN** no snapshot row is produced because of it and the savings surface is unchanged

#### Scenario: Non-qualifying product omitted

- **WHEN** a product has neither a direct Alko reference offer nor a CONFIRMED link
- **THEN** no snapshot row SHALL be produced for it rather than a guessed gap

#### Scenario: Re-run is idempotent

- **WHEN** the snapshot pass runs twice for the same as-of date
- **THEN** the second run SHALL overwrite the same keyed rows without duplicating them

#### Scenario: Per-product failure isolated

- **WHEN** one product's evaluation throws during the pass
- **THEN** the remaining products SHALL still materialize and the failure SHALL be logged

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

### Requirement: Market overview aggregates

The savings surface SHALL present a market-overview section with deterministic aggregates computed over observed data: average observed price per beverage category, the largest observed cross-border difference (with ties broken deterministically), and the count of observed products. Selection and ordering SHALL use objective criteria only; no editorial or commercial weighting SHALL affect any figure. The aggregate product universe SHALL be the same shared listing universe as the catalog: non-alcoholic rows (zero or unknown ABV in an alcohol category) and rows held for review SHALL NOT contribute to any average, difference, or count.

#### Scenario: Aggregates are objective and deterministic

- **WHEN** the market overview renders
- **THEN** each figure derives from observed data through a fixed, reproducible computation, and repeated renders with unchanged data produce identical output

#### Scenario: Insufficient data degrades gracefully

- **WHEN** a category lacks sufficient observations
- **THEN** that category's figure is omitted rather than estimated or zero-filled

#### Scenario: Non-alcoholic rows never headline a category

- **WHEN** the largest-difference figure is selected for a category
- **THEN** the selected product contains alcohol (ABV greater than zero, no review hold), and a zero-ABV row can never appear as the category's largest observed difference

### Requirement: Post-calculation savings summary

After a landed-cost calculation whose product has Alko reference offers, the result SHALL show a prominent savings summary ("Tilaamalla Virosta säästät arviolta €X verrattuna Alkon hintaan") built from the display-only `alkoBenchmark` comparison. The summary is display-only: it never enters the total, the breakdown, or any ranking input. When no benchmark exists the section SHALL be absent rather than showing a placeholder figure.

#### Scenario: Benchmark exists

- **WHEN** a calculation result renders for a product with Alko reference offers
- **THEN** the summary states the estimated saving against the Alko price, consistent with the `alkoBenchmark` figures already on the result

#### Scenario: No benchmark renders nothing

- **WHEN** a calculation result renders for a product without Alko reference offers
- **THEN** the savings summary section is absent

### Requirement: Savings summary is factual and lint-clean

Savings and suggestion copy SHALL state figures factually with their estimate and as-of context. Advice phrasing banned by the content vocabulary lint ("best deal", "good time to buy", "buy now" and their locale equivalents) SHALL NOT appear on any public surface.

#### Scenario: Copy passes the content lint

- **WHEN** the savings summary and trip-suggestion strings are added to the message catalogs
- **THEN** the content lint passes in both locales with no advice-phrasing violations

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

#### Scenario: Honest zero state

- **WHEN** no snapshot day within the lookback contains an eligible row
- **THEN** the endpoint SHALL return an empty list with the maximal day's as-of date and zero eligible coverage instead of an error

### Requirement: Best deal per merchant listing

`GET /api/v1/savings/best-per-merchant` SHALL return, for the latest
materialized savings day, one row per cross-border merchant: that merchant's
observed row with the largest absolute gap in cents, ties broken by product id
ascending. Merchant `alko` SHALL be excluded (the domestic reference is not a
deal provider). Each row SHALL carry the same provenance fields as the savings
listing (product, category, merchant, merchant country, observed price,
landed total, Alko reference, gap in cents and basis points, reliability,
confidence, tax dataset version) plus the `asOf` day. The endpoint SHALL be
read-only and deterministic — the same D1 state yields a byte-identical body —
behind the same age gate and rate limiter as the savings listing. While no day
has materialized, it SHALL return 200 with an empty list and a null `asOf`
(the honest zero state). A newly onboarded merchant SHALL appear
automatically once its rows materialize; no registration or editorial step
exists.

#### Scenario: One row per cross-border merchant, biggest gap first provenance

- **WHEN** the latest day holds rows for alks, longero, kippis, and mydrink
- **THEN** the response lists exactly one row per merchant — that merchant's largest-|gap| row — and excludes alko

#### Scenario: Deterministic tie-break

- **WHEN** one merchant's two rows share the same absolute gap
- **THEN** the row with the lower product id is returned, and repeated requests return a byte-identical body

#### Scenario: Honest empty state before first materialization

- **WHEN** no savings day has been materialized
- **THEN** the endpoint responds 200 with an empty list and null asOf — never an error

#### Scenario: New merchant joins without an editorial step

- **WHEN** a newly onboarded merchant's offers materialize into the latest day
- **THEN** the merchant's best deal appears in the listing on the next read

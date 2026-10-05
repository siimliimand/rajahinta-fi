# web-application Delta

## MODIFIED Requirements

### Requirement: Calculator UI

The calculator result view SHALL render an Alko benchmark line when the result carries the optional `alkoBenchmark` field: the Alko price, the difference in euros and percent, and the reference's reliability badge and timestamp. Wording SHALL be factual in both locales, including the plain statement when importing is not cheaper. The line SHALL NOT render when the field is absent, and SHALL never display as part of the total. After a successful calculation, the result SHALL be made visible to the visitor: on viewports where the result card is not already in view, it SHALL scroll into view (instantly under `prefers-reduced-motion`). The product search results SHALL collapse when a product is selected, so the chosen-product state — not the result list — remains on screen. Search dropdown rows SHALL carry the same per-unit price context as catalog rows (see per-unit price context requirement), so a pack row can never be read as a single-unit price.

#### Scenario: Benchmark line rendering

- **WHEN** a result with a benchmark field is displayed, and a pre-change record without one is displayed
- **THEN** the first shows the factual benchmark line below the breakdown and the second shows the result unchanged with no placeholder

#### Scenario: Result scrolls into view after calculation

- **WHEN** a calculation completes and the result card is not in view (mobile single-column flow)
- **THEN** the result card scrolls into view, instantly when `prefers-reduced-motion` is set

#### Scenario: Selection collapses the result list

- **WHEN** a visitor selects a product from the inline search results
- **THEN** the result list collapses and the chosen-product state renders in its place

## ADDED Requirements

### Requirement: Per-unit price context on pack rows

A search or listing row whose product is a multi-unit pack (package units parsed from the product name by the shared read-time parser) SHALL render a per-unit price context derived from the row's current price and parsed unit count, alongside the existing absolute lowest-observed-price label and the €/g embed. The context SHALL be display-only: it SHALL NOT enter any calculation input, ranking, or sort order.

#### Scenario: Pack row shows per-unit price

- **WHEN** a dropdown or listing row's product parses to more than one unit per package
- **THEN** the row renders a per-unit helper (e.g. "≈ 4,40 €/kpl") beside the absolute price

#### Scenario: Single-unit rows are unchanged

- **WHEN** a row's product parses to one unit per package
- **THEN** no per-unit helper renders

#### Scenario: Display-only

- **WHEN** the per-unit context renders
- **THEN** calculation inputs, ranking outcomes, and sort orders are byte-identical to before

### Requirement: Newsletter consent affordance

The newsletter subscribe form SHALL state, visibly beside its disabled-until-consent submit button, that ticking the consent checkbox is required to subscribe. The explicit-consent gating itself SHALL be preserved; the affordance only makes the locked state self-explanatory.

#### Scenario: Locked state is explained

- **WHEN** the consent checkbox is unticked
- **THEN** the submit button remains disabled and a visible hint states that consent is required

#### Scenario: Consent unlocks submission

- **WHEN** the visitor ticks the consent checkbox
- **THEN** the submit button enables and the hint disappears

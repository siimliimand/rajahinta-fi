# web-application Delta

## MODIFIED Requirements

### Requirement: Calculator UI

The calculator result view SHALL render an Alko benchmark line when the result
carries the optional `alkoBenchmark` field: the Alko price, the difference in
euros and percent, and the reference's reliability badge and timestamp.
Wording SHALL be factual in both locales, including the plain statement when
importing is not cheaper. The line SHALL NOT render when the field is absent,
and SHALL never display as part of the total. After a successful calculation,
the result SHALL be made visible to the visitor: on viewports where the result
card is not already in view, it SHALL scroll into view (instantly under
`prefers-reduced-motion`). The product search results SHALL collapse when a
product is selected, so the chosen-product state — not the result list —
remains on screen. Search dropdown rows SHALL carry the same per-unit price
context as catalog rows (see per-unit price context requirement), so a pack
row can never be read as a single-unit price. When opened without a selected
product and without a search query, the calculator SHALL render example
product cards derived from the best-deal-per-merchant savings listing, each
showing the snapshot's landed total and Alko gap and clearly labeled as an
example, with a link to the /savings listing. Rendering the examples SHALL NOT
invoke the calculation API and SHALL NOT create calculation records; selecting
an example SHALL load that product into the existing selector flow, after
which calculation happens only through the visitor's explicit action.

#### Scenario: Benchmark line rendering

- **WHEN** a result with a benchmark field is displayed, and a pre-change record without one is displayed
- **THEN** the first shows the factual benchmark line below the breakdown and the second shows the result unchanged with no placeholder

#### Scenario: Result scrolls into view after calculation

- **WHEN** a calculation completes and the result card is not in view (mobile single-column flow)
- **THEN** the result card scrolls into view, instantly when `prefers-reduced-motion` is set

#### Scenario: Selection collapses the result list

- **WHEN** a visitor selects a product from the inline search results
- **THEN** the result list collapses and the chosen-product state renders in its place

#### Scenario: First paint shows real examples without side effects

- **WHEN** a visitor opens /calculator directly with no query
- **THEN** example cards render the best current deal per cross-border merchant, no calculation request fires, and no calculation record is created

#### Scenario: Selecting an example enters the normal flow

- **WHEN** the visitor activates an example card
- **THEN** that product becomes the selected product in the existing selector flow and calculation happens on the visitor's explicit action

#### Scenario: Empty savings state degrades to the existing guidance

- **WHEN** the best-per-merchant listing is empty (no materialized day)
- **THEN** no example cards render and the existing type-to-search guidance stands

### Requirement: Neutral comparison views

Comparison views SHALL use neutral, objective ranking with no design element
suggesting a paid or promoted position. When opened with no products selected,
the comparison view SHALL prefill one column per cross-border merchant with
that merchant's best current deal from the savings listing, each column
labeled as an example with a link to /savings; the add-product tile SHALL
remain. Prefilled columns use read-only offer data and SHALL NOT trigger
calculations, records, or rankings, and no prefill element SHALL suggest a
paid or curated position.

#### Scenario: No promoted styling

- **WHEN** results are ranked in a comparison view
- **THEN** no visual element SHALL indicate any paid or curated position

#### Scenario: Compare opens with real merchant-diverse columns

- **WHEN** a visitor opens /compare directly
- **THEN** the grid shows one best-deal column per cross-border merchant plus the add tile, each example-labeled

#### Scenario: Prefill stays read-only

- **WHEN** the prefilled view renders
- **THEN** no calculation, ranking, or persistence call fires from the prefill itself

### Requirement: Basket builder and optimization UI

The web application SHALL provide a basket UI to add multiple products with
quantities (reusing the existing product search), select destination and
transport arrangement, and display the optimization result: the recommended
combination and up to three neutral cost-ordered alternatives, per-store cards
with per-item breakdowns, reliability and freshness badges, the aggregated
confidence level, and the structural disclaimer. The UI SHALL be hidden
entirely when the `enable_basket_optimization` flag is off, and copy SHALL
follow the controlled vocabulary. The basket builder's empty state SHALL list
the best current deal per cross-border merchant from the savings listing with
per-item add actions and a one-click example-basket fill action; the builder
SHALL NOT auto-add items. The example list SHALL be labeled as an example and
link to /savings.

#### Scenario: User optimizes a basket

- **WHEN** a user adds products with quantities and runs the optimization
- **THEN** the UI SHALL display the recommended combination, alternatives, and per-store breakdowns with confidence and freshness metadata

#### Scenario: Visual neutrality in alternatives

- **WHEN** multiple alternatives are displayed
- **THEN** no visual element SHALL suggest a promoted or preferred store beyond the objective cost ordering

#### Scenario: Flag off hides the feature

- **WHEN** the `enable_basket_optimization` flag is disabled
- **THEN** the basket UI SHALL not appear and no optimization request SHALL be made

#### Scenario: Empty basket offers examples without auto-adding

- **WHEN** a visitor opens /basket directly
- **THEN** the builder lists the per-merchant best deals with add buttons and an example-basket fill action, and the basket starts empty

#### Scenario: One-click fill respects the visitor's intent

- **WHEN** the visitor activates the example-basket fill
- **THEN** the deals are added as basket items the visitor can remove or re-quantity like any other item

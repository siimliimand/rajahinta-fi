# web-application Delta

## MODIFIED Requirements

### Requirement: Calculator UI

The calculator page SHALL, when opened without a selected product and without
a search query, render example product cards derived from the best-deal-per-
merchant savings listing, each showing the snapshot's landed total and Alko
gap and clearly labeled as an example, with a link to the /savings listing.
Rendering the examples SHALL NOT invoke the calculation API and SHALL NOT
create calculation records; selecting an example SHALL load that product into
the existing selector flow, after which calculation happens only through the
visitor's explicit action.

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

The comparison view SHALL, when opened with no products selected, prefill one
column per cross-border merchant with that merchant's best current deal from
the savings listing, each column labeled as an example with a link to
/savings; the add-product tile SHALL remain. Prefilled columns use read-only
offer data and SHALL NOT trigger calculations, records, or rankings.

#### Scenario: Compare opens with real merchant-diverse columns

- **WHEN** a visitor opens /compare directly
- **THEN** the grid shows one best-deal column per cross-border merchant plus the add tile, each example-labeled

#### Scenario: Prefill stays read-only

- **WHEN** the prefilled view renders
- **THEN** no calculation, ranking, or persistence call fires from the prefill itself

### Requirement: Basket builder and optimization UI

The basket builder's empty state SHALL list the best current deal per
cross-border merchant from the savings listing with per-item add actions and
a one-click example-basket fill action; the builder SHALL NOT auto-add items.
The example list SHALL be labeled as an example and link to /savings.

#### Scenario: Empty basket offers examples without auto-adding

- **WHEN** a visitor opens /basket directly
- **THEN** the builder lists the per-merchant best deals with add buttons and an example-basket fill action, and the basket starts empty

#### Scenario: One-click fill respects the visitor's intent

- **WHEN** the visitor activates the example-basket fill
- **THEN** the deals are added as basket items the visitor can remove or re-quantity like any other item

# web-application Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Calculator UI

The web application SHALL provide a calculator UI to search for a product, select quantity, select transport arrangement (seller-arranged / independent carrier / personal), and display the itemized breakdown with calculation-status metadata and confidence level. When the transport arrangement is personal, the UI SHALL surface the Traveller Import outcome and its excluded-from-this-calculator messaging.

#### Scenario: User runs a calculation

- **WHEN** a user selects a product and quantity
- **THEN** the UI SHALL display the itemized breakdown with confidence level and status metadata

#### Scenario: Personal transport selection

- **WHEN** a user selects personal transport and calculates
- **THEN** the UI SHALL display the Traveller Import classification outcome and its messaging instead of a distance-selling/buying breakdown

### Requirement: Explanation page

The application SHALL provide a calculation explanation page surfacing every figure's traceable inputs, rate dataset version, and timestamp.

#### Scenario: Trace a figure

- **WHEN** a user views the explanation for a result
- **THEN** each figure SHALL link back to its input value, dataset version, and timestamp

### Requirement: Neutral comparison views

Comparison views SHALL use neutral, objective ranking with no design element suggesting a paid or promoted position.

#### Scenario: No promoted styling

- **WHEN** results are ranked in a comparison view
- **THEN** no visual element SHALL indicate any paid or curated position

### Requirement: Freshness indicators

The UI SHALL surface reliability status and timestamp for every externally sourced fact.

#### Scenario: Stale price visible

- **WHEN** a price is stale
- **THEN** the UI SHALL visibly mark it stale with its timestamp, rather than presenting it like a verified figure

### Requirement: Plain outbound links

Outbound merchant links SHALL be plain links recorded for basic analytics only (click-through counts), with no purchase tracking or commission tracking infrastructure.

#### Scenario: Click recorded

- **WHEN** a user clicks a merchant link
- **THEN** the click SHALL be recorded as a count, and no purchase or commission data SHALL be collected

### Requirement: Controlled vocabulary

Product-listing copy SHALL be restricted to a controlled vocabulary (identification, classification, calculation, comparison) with no subjective adjectives. Enforcement SHALL run as an automated lint step in the content pipeline gating pull requests, not merely as a library available for ad-hoc use.

#### Scenario: Banned adjective in source

- **WHEN** generated copy or a source file contains a subjective adjective such as "best" or "amazing"
- **THEN** the content-policy lint step SHALL fail the build/CI with the offending word and context

#### Scenario: CI gate active

- **WHEN** a pull request is opened against the main branch
- **THEN** the content-policy check SHALL run as a gating job whose failure blocks the merge

### Requirement: Plain outbound links

Outbound merchant links SHALL be plain links recorded for basic analytics only (click-through counts), with no purchase tracking or commission tracking infrastructure.

#### Scenario: Click recorded

- **WHEN** a user clicks a merchant link
- **THEN** the click SHALL be recorded as a count, and no purchase or commission data SHALL be collected

### Requirement: Correction flag affordance

The calculator result page SHALL provide a "flag a problem" affordance that submits a correction request for the displayed calculation record (via `POST /api/v1/corrections`), and the ranking methodology page SHALL link to the correction flow. The affordance SHALL confirm to the user that a review item was created.

#### Scenario: User flags a result from the UI

- **WHEN** a user activates the flag affordance on a calculator result
- **THEN** the application SHALL submit the correction request referencing the calculation record and SHALL show confirmation

#### Scenario: Methodology page links the flow

- **WHEN** a user views the ranking methodology page
- **THEN** a link SHALL be present through which a correction can be raised

### Requirement: Historical charts in product views

The calculator result view and the compare page SHALL render a historical price chart and a historical landed-cost chart from the price-history API, with the tax-change attribution markers, reliability badges per series, and a statement of the earliest available observation date. Charts SHALL be hidden when the `enable_historical_price_intelligence` flag is disabled.

#### Scenario: Chart renders with attribution markers

- **WHEN** a user views a product whose history contains a TAX_RULE_CHANGE step
- **THEN** the chart SHALL mark that step and label it with the bounding rule version labels

#### Scenario: Flag hides charts

- **WHEN** the feature flag is disabled for the session
- **THEN** the historical charts SHALL not appear and no price-history request SHALL be made

### Requirement: Neutral, dependency-free chart rendering

Charts SHALL be implemented as SVG components with no new charting dependency, using neutral styling with no design element that suggests promotion of any merchant, and labels restricted to the controlled vocabulary (identification, classification, calculation, comparison).

#### Scenario: No promotional styling or vocabulary

- **WHEN** a chart renders merchant series
- **THEN** all series SHALL receive visually equal treatment and all labels SHALL come from the controlled vocabulary

### Requirement: Freshness indicators on historical data

Every chart series SHALL display the reliability status and the timestamp of the most recent observation it derives from.

#### Scenario: Stale series flagged

- **WHEN** a series derives from STALE observations
- **THEN** the chart SHALL show the STALE indicator rather than presenting the data as verified

### Requirement: Basket builder and optimization UI

The web application SHALL provide a basket UI to add multiple products with quantities (reusing the existing product search), select destination and transport arrangement, and display the optimization result: the recommended combination and up to three neutral cost-ordered alternatives, per-store cards with per-item breakdowns, reliability and freshness badges, the aggregated confidence level, and the structural disclaimer. The UI SHALL be hidden entirely when the `enable_basket_optimization` flag is off, and copy SHALL follow the controlled vocabulary.

#### Scenario: User optimizes a basket

- **WHEN** a user adds products with quantities and runs the optimization
- **THEN** the UI SHALL display the recommended combination, alternatives, and per-store breakdowns with confidence and freshness metadata

#### Scenario: Visual neutrality in alternatives

- **WHEN** multiple alternatives are displayed
- **THEN** no visual element SHALL suggest a promoted or preferred store beyond the objective cost ordering

#### Scenario: Flag off hides the feature

- **WHEN** the `enable_basket_optimization` flag is disabled
- **THEN** the basket UI SHALL not appear and no optimization request SHALL be made

### Requirement: Multi-store comparison view

The compare page SHALL offer a store-grouped comparison view showing how a basket's costs distribute across stores, with the same neutrality, freshness, and controlled-vocabulary rules, behind the same feature flag.

#### Scenario: Store-grouped comparison rendered

- **WHEN** a user views the multi-store comparison for a basket
- **THEN** the view SHALL group costs per store with per-item figures and reliability statuses, ordered objectively

### Requirement: Scenario controls in the calculator UI

The calculator UI SHALL provide a save-scenario control (name input plus save action) and a scenario picker to load a saved scenario; loading SHALL repopulate the calculator inputs and re-run the calculation against current data. The account page SHALL list the user's saved scenarios. These controls SHALL be hidden when the `enable_advanced_features` flag is off.

#### Scenario: Save and reload from the UI

- **WHEN** a user saves the calculator state under a name and later loads it
- **THEN** the inputs SHALL be repopulated and a fresh calculation SHALL run

#### Scenario: Flag off hides scenario controls

- **WHEN** the flag is disabled
- **THEN** the save/load controls SHALL not be rendered and no scenario request SHALL be made

### Requirement: Report export affordance

The calculator result view and the account calculation-history entries SHALL provide export actions for the report formats (JSON download, CSV download, print report). Export labels SHALL use controlled vocabulary.

#### Scenario: Export from a result

- **WHEN** a user activates an export action on a calculation result
- **THEN** the corresponding report SHALL be downloaded or opened for printing, carrying the disclaimer and per-line provenance

### Requirement: Merchant data-freshness display in comparisons

Where comparison results surface a merchant's offers, the UI SHALL display the merchant's factual data-reliability summary (counts/shares per status, freshest observation, governance status) with its timestamp, using controlled-vocabulary labels and neutral equal-treatment styling. The display SHALL NOT alter or suggest any change to the objective sort order.

#### Scenario: Factual freshness line

- **WHEN** a merchant's offers are shown in a comparison
- **THEN** a factual reliability summary with timestamp SHALL be visible near the offers, styled identically for every merchant

### Requirement: Declaration guidance panel

The calculator result detail page SHALL render the declaration assistant's advanced guidance (derivation, deadline, checklist, caveats) in a clearly bounded panel using observed-pattern phrasing, visible when the `enable_advanced_features` flag is on.

#### Scenario: Guidance rendered

- **WHEN** a user expands the declaration guidance panel on a result
- **THEN** the derivation, deadline, checklist, and any caveats SHALL be displayed with the standing disclaimer

### Requirement: Finnish default locale with English secondary

The frontend SHALL use a message-catalog localization setup (next-intl or equivalent) with Finnish as the default locale and English secondary. User-facing copy SHALL live in message catalogs, and the content-policy lint SHALL cover both locales. The rendered `lang` attribute SHALL match the active locale.

#### Scenario: Default renders Finnish

- **WHEN** a user visits without a locale preference
- **THEN** the UI SHALL render in Finnish with `lang="fi"`

#### Scenario: Lint polices both catalogs

- **WHEN** either the Finnish or English catalog introduces disallowed vocabulary
- **THEN** the content-policy lint SHALL fail

### Requirement: Shared navigation

The application SHALL provide a layout-level header with the five destinations (calculator, compare, basket, account, ranking) on every page, and a footer carrying the disclaimer and methodology link. Per-page hand-rolled back-links SHALL be removed.

#### Scenario: Navigation on every page

- **WHEN** a user lands on any route
- **THEN** the header SHALL offer the five destinations without returning home first

### Requirement: Debounced search input

Search input SHALL debounce submissions by approximately 300 ms so rapid keystrokes do not queue requests.

#### Scenario: Rapid typing sends one request

- **WHEN** a user types quickly and pauses
- **THEN** one debounced search request SHALL be issued for the settled query

### Requirement: Feature flags inline in initial HTML

Feature-flag states SHALL be inlined in the initial HTML payload so gated UI renders with first paint and does not appear late after a client-side fetch.

#### Scenario: No gated-UI flash

- **WHEN** a page with flag-gated UI loads
- **THEN** the gated UI's visibility SHALL match its flag state in the first render, with no late appearance

### Requirement: SEO surface

The frontend SHALL provide a sitemap, robots rules, and per-product pages with metadata drawn from product data.

#### Scenario: Product page metadata

- **WHEN** a crawler fetches a product page
- **THEN** it SHALL receive title and description metadata specific to that product

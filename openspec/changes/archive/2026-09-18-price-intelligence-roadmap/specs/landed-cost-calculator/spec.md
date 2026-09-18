# landed-cost-calculator Specification

## ADDED Requirements

### Requirement: Result presentation

The calculator SHALL present its result answer-first: the estimated landed cost as the primary figure, followed by the explicit difference against the Finland reference, then the full breakdown beneath. The breakdown figures SHALL remain traceable to the result object's inputs (existing explainability contract, unchanged). The result card SHALL surface the data reliability status and timestamp carried by the underlying data, using the existing reliability-status model, and SHALL render the structural disclaimer from the result object.

#### Scenario: Answer before breakdown

- **WHEN** a calculation completes
- **THEN** the primary figure, the Finland comparison, and a "cheaper/dearer" text label render before the detailed breakdown, and the comparison is never conveyed by color alone

#### Scenario: Freshness is visible

- **WHEN** a result renders
- **THEN** the card shows the reliability status and observation timestamp of the price data feeding the result

#### Scenario: Disclaimer comes from the result object

- **WHEN** a result renders
- **THEN** the disclaimer text rendered is the result object's structural disclaimer field

### Requirement: Quick and advanced calculation

The calculator SHALL offer a quick path (country, product, price, quantity) with advanced options (travel costs, fuel, ferry, quantities, other costs) collapsed by default. Quick-path results SHALL equal full-path results given the same inputs; advanced inputs only add terms.

#### Scenario: Quick path is the default

- **WHEN** the calculator loads
- **THEN** only the quick-path inputs are visible, with advanced options available behind an explicit control

### Requirement: Input units and validation

Calculator inputs SHALL display their unit beside the field (e.g. `320 km`, `6.5 L / 100 km`), SHALL use numeric keyboards on mobile, and SHALL validate inline with specific error messages.

#### Scenario: Units are unambiguous

- **WHEN** a numeric input renders
- **THEN** its unit is visible adjacent to the field in both locales

### Requirement: Sticky summary

On desktop viewports the calculator SHALL render a summary card that stays visible while inputs change, showing the running landed-cost estimate and the Finland comparison.

#### Scenario: Summary persists during input

- **WHEN** the visitor scrolls or edits inputs on a desktop viewport
- **THEN** the summary card remains visible and reflects current inputs

# trip-feasibility-calculator Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Break-even volume computation

Given passenger count, vehicle type, ticket cost, and fuel cost, the calculator SHALL compute the travel cost per traveller and the break-even purchase volume: travel cost divided by the unit price difference between the domestic reference price and the foreign price. All arithmetic SHALL be pure and deterministic, and the result SHALL cite the price data it used.

#### Scenario: Break-even computed

- **WHEN** valid travel costs and a price difference are provided
- **THEN** the result SHALL state the break-even volume and the travel-cost derivation behind it

#### Scenario: No price difference

- **WHEN** the foreign price is not below the domestic reference
- **THEN** the calculator SHALL report that no break-even exists instead of dividing by zero or returning a negative volume

### Requirement: Allowance capping with versioned datasets

Break-even and suggested volumes SHALL be capped by the EU personal-use indicative limits from the `travellerAllowanceDatasets` version effective on the travel date. The result SHALL name the dataset version and SHALL carry an explicit disclaimer that the limits are indicative figures, not legal advice.

#### Scenario: Cap applied

- **WHEN** the break-even volume exceeds the applicable allowance for a category
- **THEN** the result SHALL show the uncapped figure, the applicable cap, and the dataset version

#### Scenario: Effective version resolved

- **WHEN** allowances changed between two dates
- **THEN** the same trip input evaluated on each date SHALL resolve the respective effective version

### Requirement: Neutral affiliate slot

Curated ferry operator links SHALL be returned as a separate block from the calculation result and SHALL have zero influence on inputs, computation, or ordering. A compliance test SHALL verify that calculation output is identical with and without affiliate data present.

#### Scenario: Affiliate presence changes nothing

- **WHEN** the calculation runs with zero, one, or many affiliate rows in the database
- **THEN** the calculation result SHALL be byte-identical in all cases

#### Scenario: Visually separated rendering

- **WHEN** the trip page renders
- **THEN** partner links SHALL appear in a visually distinct container labeled as partner content, separate from the calculation output

### Requirement: Input validation and disclaimers

The trip endpoint SHALL validate passengers, vehicle type, and cost inputs, SHALL be rate-limited, and SHALL render the indicative-limits disclaimer as a structural part of the result object, not a UI-only string.

#### Scenario: Invalid input rejected

- **WHEN** a request carries a negative cost or unknown vehicle type
- **THEN** the API SHALL reject it with a validation error before any computation

### Requirement: Route presets

The trip calculator SHALL offer one-click route presets (Helsinki–Tallinn ferry patterns among them) that prefill realistic distance, vehicle, consumption, fuel-price, and ferry-ticket assumptions. Preset values SHALL remain fully editable and SHALL be shown as editable inputs after applying.

#### Scenario: Preset prefills editable assumptions

- **WHEN** the visitor applies a route preset
- **THEN** distance, consumption, fuel price, and ferry cost inputs fill with the preset values and remain editable

### Requirement: Break-even figure

The trip result SHALL include a break-even figure: transport and other trip costs divided by the per-basket saving, stating how many baskets' worth of saving the trip costs consume. The card SHALL display the formula with its input values. The figure SHALL be a displayed derivation of existing result figures and SHALL NOT alter the result object contract.

#### Scenario: Break-even shows its derivation

- **WHEN** a trip result renders
- **THEN** the break-even card shows the computed figure together with the transport cost, other costs, and per-unit saving values that produced it

#### Scenario: Zero saving handles safely

- **WHEN** the per-basket saving is zero or negative
- **THEN** the card states the trip does not pay for itself instead of dividing by zero

### Requirement: Allowance hint

The trip result SHALL link to the allowance explorer with copy noting that customs allowance rules apply to cross-border purchases.

#### Scenario: Result links allowances

- **WHEN** a trip result renders
- **THEN** an allowance hint links to `/allowances` (locale-appropriate)


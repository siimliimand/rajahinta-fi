# trip-feasibility-calculator Specification

## MODIFIED Requirements

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

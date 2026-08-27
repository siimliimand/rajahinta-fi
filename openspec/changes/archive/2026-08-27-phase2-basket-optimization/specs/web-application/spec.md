# web-application Specification

## ADDED Requirements

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

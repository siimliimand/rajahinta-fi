## ADDED Requirements

### Requirement: Launch gate enforced on endpoints

The launch-gating flag SHALL be enforced on the calculation and price-data endpoints, not merely defined as a service. Alcohol price data and calculation features SHALL be inaccessible while the flag is off.

#### Scenario: Calculation blocked pre-launch

- **WHEN** the launch gates are not all confirmed
- **THEN** `POST /api/v1/calculator` SHALL return 403 regardless of other feature flags

#### Scenario: Price data blocked pre-launch

- **WHEN** the legal-opinion gate is not confirmed
- **THEN** product/price discovery endpoints SHALL return 403

#### Scenario: Flag on after launch conditions

- **WHEN** legal opinion, tax-source mapping, and correction mechanism are all confirmed
- **THEN** calculation and price-data endpoints SHALL be reachable

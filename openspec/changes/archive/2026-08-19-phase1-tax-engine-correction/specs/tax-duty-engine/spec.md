## MODIFIED Requirements

### Requirement: Alcohol excise calculation

The system SHALL calculate alcohol excise duty from product category, alcohol percentage, and volume, using official Finnish Tax Administration rate tables as the primary source rather than independently derived figures. The category produced by normalisation SHALL resolve to a seeded rule; fallback constants SHALL be used only when no rule is found, and SHALL match the seeded official values.

#### Scenario: Category resolves to seeded rule

- **WHEN** a product's normalised category maps to a seeded rule
- **THEN** the excise SHALL equal the official rate applied to the product's volume

#### Scenario: Beer excise uses official formula

- **WHEN** a beer product is calculated
- **THEN** the excise SHALL use the official per-degree-Plato (hectolitre-percent) rate, not a hardcoded ABV-tier table

#### Scenario: Wine tier by ABV

- **WHEN** a still-wine product has an ABV between 15% and 18%
- **THEN** the excise SHALL apply the higher still-wine rate (4.55), and sparkling wine above 1.2% SHALL apply 3.73

#### Scenario: Cider and long drink

- **WHEN** a cider is calculated
- **THEN** the excise SHALL be a flat per-litre-of-product rate
- **WHEN** an RTD/long drink is calculated
- **THEN** the excise SHALL be per-litre-of-alcohol at the spirits rate

### Requirement: Container duty calculation

The system SHALL calculate beverage-container duty as a distinct calculation from alcohol excise, applying the general rate (€0.51/litre) resolved from the seeded container-duty rule, unless an exemption applies.

#### Scenario: Seeded rule is reachable

- **WHEN** a container-duty calculation runs
- **THEN** it SHALL resolve the seeded container-duty rule (by container-duty category key, not the packaging string) and report VERIFIED reliability when the rule is verified

#### Scenario: Deposit-return exemption

- **WHEN** packaging participates in the Finnish deposit-return system
- **THEN** the container duty SHALL be exempted
- **WHEN** deposit-system status cannot be determined
- **THEN** the duty calculation SHALL be flagged ESTIMATED, never silently assumed either way

## ADDED Requirements

### Requirement: Tax-rule version traceability

Every persisted calculation SHALL record the numeric ids of the excise and container-duty rule versions used to produce it.

#### Scenario: Rule versions recorded

- **WHEN** a landed-cost calculation is persisted
- **THEN** `exciseRuleVersionId` and `containerDutyRuleVersionId` SHALL reference the tax-rule rows applied, and SHALL NOT be null when a rule was used

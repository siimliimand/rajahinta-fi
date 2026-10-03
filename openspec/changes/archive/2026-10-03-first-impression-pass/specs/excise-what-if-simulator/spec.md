# Spec Delta: excise-what-if-simulator

## MODIFIED Requirements

### Requirement: Scenario labeling

The simulator's display name SHALL be "Scenario calculator" (Finnish equivalent per locale copy) across navigation, footer, and page headings. The route SHALL remain `/what-if` with no redirect. The page intro SHALL present concrete example questions (fuel price change, quantity change, ferry cost change, tax change) so first-time visitors understand the tool's purpose without clicking. Tax-rate inputs and result lines SHALL name the physical unit of the selected rate family in consumer terms — euros per litre of pure alcohol for spirit-family rates, euros per litre of beverage for fermented-family rates — and consumer copy in either locale SHALL NOT use the internal term "kaava-yksikkö" (formula unit).

#### Scenario: Labels change, URL does not

- **WHEN** navigation or the page renders
- **THEN** the tool is labeled "Scenario calculator" while the route remains `/what-if`

#### Scenario: Rate unit is named physically

- **WHEN** a hypothetical tax-rate input or result line renders for a spirits-family scenario
- **THEN** it reads in euros per litre of pure alcohol; for a fermented-family scenario it reads in euros per litre of beverage; neither locale's consumer copy contains "kaava-yksikkö"

#### Scenario: Examples are visible on the page

- **WHEN** the scenario page renders
- **THEN** the server shell includes example scenario questions in the intro copy

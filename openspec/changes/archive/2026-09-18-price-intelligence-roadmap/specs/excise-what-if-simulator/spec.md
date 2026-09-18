# excise-what-if-simulator Specification

## ADDED Requirements

### Requirement: Scenario labeling

The simulator's display name SHALL be "Scenario calculator" (Finnish equivalent per locale copy) across navigation, footer, and page headings. The route SHALL remain `/what-if` with no redirect. The page intro SHALL present concrete example questions (fuel price change, quantity change, ferry cost change, tax change) so first-time visitors understand the tool's purpose without clicking.

#### Scenario: Labels change, URL does not

- **WHEN** navigation or the page renders
- **THEN** the tool is labeled "Scenario calculator" while the route remains `/what-if`

#### Scenario: Examples are visible on the page

- **WHEN** the scenario page renders
- **THEN** the server shell includes example scenario questions in the intro copy

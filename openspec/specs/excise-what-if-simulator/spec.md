# excise-what-if-simulator Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Hypothetical rate substitution through existing engines

The simulator SHALL recompute product prices by substituting a user-supplied hypothetical excise rate into the existing excise math, keeping all other inputs and the baseline dataset version fixed. The module SHALL be pure: stored rules SHALL never be mutated and no scenario SHALL be persisted server-side.

#### Scenario: Baseline version cited

- **WHEN** a what-if result is produced
- **THEN** it SHALL cite the baseline tax dataset version and the hypothetical rate applied

#### Scenario: Stored rules untouched

- **WHEN** the simulator runs
- **THEN** no tax rule row SHALL be modified and no scenario row SHALL be written

### Requirement: Structural HYPOTHETICAL disclaimer

Every what-if result SHALL carry a structural disclaimer field stating the output is a hypothetical scenario, not a forecast, estimate of future prices, or official statement. The disclaimer SHALL be part of the result object and the UI SHALL render it prominently, with wording stronger than the standard calculator disclaimer and free of forecast or political language.

#### Scenario: Disclaimer travels with the result

- **WHEN** a what-if result is rendered or shared
- **THEN** the HYPOTHETICAL disclaimer SHALL be present in the payload and visible in the rendering

### Requirement: Rate limiting and anonymous access

The what-if endpoint SHALL be rate-limited, SHALL NOT require an account, and SHALL NOT store personal data. Sharing SHALL work through an opaque token encoding the scenario inputs, decoded read-only by the embeddable widget route.

#### Scenario: Shareable embed

- **WHEN** a user opens a share or embed URL with a valid token
- **THEN** the widget SHALL render the same scenario result with the disclaimer, without requiring authentication

#### Scenario: Rate limited

- **WHEN** a client exceeds the configured request rate
- **THEN** the API SHALL respond with the standard rate-limit error and Retry-After header

### Requirement: Scenario labeling

The simulator's display name SHALL be "Scenario calculator" (Finnish equivalent per locale copy) across navigation, footer, and page headings. The route SHALL remain `/what-if` with no redirect. The page intro SHALL present concrete example questions (fuel price change, quantity change, ferry cost change, tax change) so first-time visitors understand the tool's purpose without clicking.

#### Scenario: Labels change, URL does not

- **WHEN** navigation or the page renders
- **THEN** the tool is labeled "Scenario calculator" while the route remains `/what-if`

#### Scenario: Examples are visible on the page

- **WHEN** the scenario page renders
- **THEN** the server shell includes example scenario questions in the intro copy


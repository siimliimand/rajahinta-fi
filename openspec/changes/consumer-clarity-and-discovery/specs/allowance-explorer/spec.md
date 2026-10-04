# allowance-explorer Delta

## MODIFIED Requirements

### Requirement: Allowance page renders evidence, not conclusions

The `/allowances` page SHALL render the resolved dataset as a date-addressable view: a date picker defaulting to today, per-category caps each with a concise Finnish summary line (category and cap), the version label and effective window, and a static per-category container-equivalent helper (display-only arithmetic converting the cap into common container counts, phrased within the controlled vocabulary). Every stored source citation SHALL reach the page verbatim and unmodified, rendered as an evidence link inside a collapsed evidence disclosure per dataset block; the dataset-level citation SHALL remain verbatim and visible on the page. The page SHALL carry standing "guidance, not legal advice" framing and SHALL NOT paraphrase citations into legal conclusions. The page SHALL include a version-history section fed by the versions endpoint.

#### Scenario: Citations rendered verbatim

- **WHEN** the allowances page renders a resolved dataset version
- **THEN** each category's stored citation appears inside the evidence disclosure exactly as stored, as an evidence link, unmodified from the stored text

#### Scenario: Finnish summary per category

- **WHEN** the allowances page renders a category cap
- **THEN** the row shows a concise Finnish summary line and the full verbatim citation remains available through the evidence disclosure

#### Scenario: Container equivalents are display-only arithmetic

- **WHEN** a category renders its cap
- **THEN** the container-equivalent helper states a plain arithmetic conversion of the cap and contains no advice phrasing

# compliance-governance — Delta Spec

## ADDED Requirements

### Requirement: Content vocabulary enforcement

The compliance governance module SHALL enforce the content vocabulary policy (no subjective/promotional adjectives) by integrating content linting into the data acquisition pipeline. Every product ingested SHALL be linted, and violations SHALL be recorded in the pipeline run report.

#### Scenario: Pipeline report includes violations

- **WHEN** a pipeline run ingests products containing banned promotional vocabulary
- **THEN** the pipeline run report SHALL include violation counts and details as a compliance signal

#### Scenario: Violation trend tracked

- **WHEN** compliance metrics are queried
- **THEN** the count of content vocabulary violations per pipeline run SHALL be available as a compliance KPI metric
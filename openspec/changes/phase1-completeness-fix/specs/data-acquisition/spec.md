# data-acquisition — Delta Spec

## ADDED Requirements

### Requirement: Content linting pipeline step

The pipeline orchestrator SHALL include a content linting step after data mapping and before upsert. The step SHALL run the content linting service against every mapped product's name and description, and SHALL include results in the pipeline run report.

#### Scenario: Lint step runs after mapping

- **WHEN** the pipeline orchestrator executes a run for a merchant
- **THEN** after the DataMappingService maps raw records and before the UpsertPortAdapter persists them, the content linting service SHALL be invoked on the mapped product names

#### Scenario: Lint violations in pipeline report

- **WHEN** a product triggers a content vocabulary violation
- **THEN** the pipeline run report SHALL include the violation detail (pattern matched, matching text, product identifier) in its quality section

### Requirement: Staging seed data

A staging-specific seed data set SHALL exist, separate from the production seed, containing test merchant configurations and test tax rules suitable for legal/tax review of rule changes.

#### Scenario: Staging uses separate data

- **WHEN** the staging seed is applied to the staging database
- **THEN** the staging environment SHALL contain test merchant data and test tax rules that are distinct from the production data set

#### Scenario: Staging seed is reproducible

- **WHEN** the staging database is dropped and recreated
- **THEN** the staging seed SHALL produce a consistent, known state suitable for testing
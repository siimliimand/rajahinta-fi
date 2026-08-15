## ADDED Requirements

### Requirement: Three-tier environment promotion

The project SHALL provide three environments promoted in strict order: development → staging → production. Code SHALL NOT skip staging on its way to production.

#### Scenario: Promotion order enforced

- **WHEN** a deployment pipeline runs
- **THEN** code SHALL deploy to development first, staging second, and production only after passing staging gates

### Requirement: Production isolation

Secrets and credentials for production SHALL be stored in a separate, access-restricted environment. Development and staging MUST use their own credential sets, never production credentials.

#### Scenario: Developer cannot access production secrets

- **WHEN** a developer runs the application locally in development mode
- **THEN** the application SHALL NOT have access to production database credentials or API keys

### Requirement: Staging data realism

The staging environment SHALL contain its own copy of the tax-rule dataset and merchant data, generated from the same sources as production but not sharing the production dataset.

#### Scenario: Rule change review uses realistic data

- **WHEN** a new tax-dataset version is prepared for review
- **THEN** the legal/tax reviewer SHALL be able to inspect the change against the staging data before it reaches production
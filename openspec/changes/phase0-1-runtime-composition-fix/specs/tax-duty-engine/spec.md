# tax-duty-engine — Delta Spec

## MODIFIED Requirements

### Requirement: Tax-type vocabulary consistency

The excise engine, the tax-rule seed (official and staging placeholders), and every test fixture SHALL reference a single exported `TAX_TYPES` constant (or `TaxType` union) from core-domain for the tax-type discriminator. No string literal for a tax type SHALL appear at a query, insert, or fixture site.

#### Scenario: Engine and seed share one vocabulary

- **WHEN** the excise engine queries applicable rules and the seed inserts rule rows
- **THEN** both SHALL use the same constant value for excise (`excise`) and container duty (`container_duty`), so a rule inserted by the seed is always retrievable by the engine through the real repository

#### Scenario: Existing seeded rows are repaired by migration

- **WHEN** a database contains rows seeded with the legacy `excise_duty` discriminator
- **THEN** a committed Drizzle data migration SHALL rewrite them to `excise` before any seed or deploy step runs, because the seed's version-label skip logic will not repair them

#### Scenario: Documentation matches the implemented vocabulary

- **WHEN** a developer reads the schema and repository doc comments (`schema.ts`, `repository-registry.interface.ts`, `tax-rule-query.service.ts`)
- **THEN** the documented discriminator values SHALL match the exported constant, with no stale `excise_duty` references

### Requirement: Official dataset has an execution path

The versioned official dataset (`SEED_RULES` / `seedTaxRules`, v1.0-2024 … v3.0-2026 with vero.fi rates) SHALL be seeded through a real execution path (staging seed runner and/or deploy pipeline), not exist only as code referenced by comments. A freshly deployed staging database SHALL contain the official versioned rows alongside clearly-marked staging placeholders whose version labels never collide with the official set.

#### Scenario: Fresh staging database contains official versions

- **WHEN** the staging deploy workflow completes against an empty database
- **THEN** the database SHALL contain schema (from migrations) and tax rules with version labels v1.0-2024, v2.0-2025, and v3.0-2026, plus the v9999-staging placeholders

#### Scenario: Staging placeholders remain isolated

- **WHEN** the staging seed runs with the official dataset included
- **THEN** placeholder rows SHALL retain their own version label and fake merchant/EAN namespace, and the official rows SHALL be byte-identical to the production dataset values

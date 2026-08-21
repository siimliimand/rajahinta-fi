# mvp-testing — Delta Spec

## MODIFIED Requirements

### Requirement: Composition-root smoke test

A test SHALL boot the real application module (the same module graph production uses), fake only the database connection at the repository boundary, and assert via `ModuleRef` that the calculator service holds non-null port implementations and the excise service holds the concrete tax-rule repository adapter, then execute one real calculation. This test SHALL run in CI.

#### Scenario: Null-port regression caught before merge

- **WHEN** a refactor moves port registration out of the consuming module's scope
- **THEN** the composition smoke test SHALL fail at the non-null assertion or the calculation step

### Requirement: Real-stack integration test

A test SHALL apply the committed Drizzle migrations to a real (throwaway) PostgreSQL instance, run `seedTaxRules`, and calculate through `AlcoholExciseService` backed by the real Drizzle tax-rate repository — the only test path where engine vocabulary and seed vocabulary must agree through the real query layer. It SHALL assert official vero.fi values, including: 2024 5 % 0.5 l beer excise = 91 snt; wine >1.2–2.8 % resolving 36 snt/l before and 50 snt/l after 1.4.2026; spirits 2026 above 10 % = 56.28 snt/cl. It SHALL run in CI.

#### Scenario: Vocabulary split caught by the real query path

- **WHEN** the engine's tax-type value and the seed's tax-type value diverge (string literal reintroduced on either side)
- **THEN** the real-stack integration test SHALL return zero applicable rules and fail against the asserted official values

#### Scenario: Fixture consensus cannot mask data defects

- **WHEN** a fixture repository and the production repository disagree on lookup semantics
- **THEN** the integration test against the real repository and real seed SHALL fail, independent of what the in-memory fixtures encode

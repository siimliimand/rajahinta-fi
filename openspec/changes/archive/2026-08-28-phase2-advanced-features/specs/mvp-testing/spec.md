# mvp-testing Specification Delta

## ADDED Requirements

### Requirement: Advanced-features test coverage

The advanced features (saved scenarios, calculation reports, merchant reliability scoring, declaration advanced guidance) SHALL be covered by: unit tests for each new service using real implementations and no `vi.fn()` mocks (score aggregation across status mixes, guidance assembly incl. caveats and deadline, report generation per format, scenario upsert semantics); API tests covering flag-off rejection, entitlement rejection on reports, scenario CRUD round-trip, and the GDPR lifecycle (export includes scenarios, erasure cascades); an extended declaration safety proof that the no-submission guarantee and type-level read-only constraints hold across the new guidance paths; and a neutrality lockstep test asserting the ranking service rejects score-carrying inputs, mirroring the billing-isolation convention.

#### Scenario: Unit tests use real engines

- **WHEN** the advanced-feature unit suites run
- **THEN** they SHALL exercise real service implementations rather than vi.fn() mocks, per the golden-dataset convention

#### Scenario: Safety proofs extended

- **WHEN** the declaration safety suite runs against the extended service
- **THEN** the no-submission guarantee and compile-time read-only constraint SHALL both hold

#### Scenario: Neutrality lockstep

- **WHEN** a merchant-score field is included in a ranking input
- **THEN** the ranking service SHALL reject it as an unknown property

# mvp-testing Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Unit tests for high-liability code

Unit tests SHALL cover every tax/duty formula, classification rule, and confidence-computation function, at the highest coverage bar in the system.

#### Scenario: Formula regression

- **WHEN** a change touches an excise formula
- **THEN** the unit tests SHALL run and catch any deviation from the official rate

### Requirement: Golden-dataset regression tests

A fixed set of known product/transport/tax input combinations with manually verified expected outputs SHALL run on every deploy and every new tax-dataset version. Expected outputs SHALL be manually verified against official sources, not against the engine's current behaviour.

#### Scenario: Dataset version gate

- **WHEN** a new tax-dataset version is published
- **THEN** the golden-dataset tests SHALL pass against the manually verified expected outputs before the version ships

#### Scenario: Engine divergence caught

- **WHEN** an engine or data change produces a value that differs from the official-source-derived expectation
- **THEN** the golden test SHALL fail rather than being updated to match

### Requirement: Compliance tests

Automated checks SHALL verify that no ranking result correlates with any commercial/payment signal and that banned promotional vocabulary does not appear in generated product copy.

#### Scenario: Neutrality check

- **WHEN** ranking results are produced
- **THEN** automated checks SHALL confirm no correlation with a payment signal

### Requirement: Load tests

Load/performance tests SHALL run against the Landed-Cost Calculation endpoint, the highest-traffic and most computation-heavy path.

#### Scenario: Endpoint under load

- **WHEN** the calculation endpoint is driven at production-scale concurrency
- **THEN** it SHALL meet the defined latency and throughput targets

### Requirement: Load test exercises the endpoint

The load/performance test for the Landed-Cost Calculation SHALL exercise the HTTP endpoint, or its orchestrator-only scope SHALL be documented in the test header so the coverage claim is accurate.

#### Scenario: HTTP-level load

- **WHEN** the load test runs
- **THEN** it SHALL measure the calculation path end-to-end (or state explicitly that it measures orchestrator throughput only)

### Requirement: Load test integration

A load test suite SHALL exist for the Landed-Cost Calculation endpoint, exercising the full HTTP path with realistic payloads, baseline thresholds, and non-blocking CI integration.

#### Scenario: Load test runs successfully

- **WHEN** the load test is invoked against a running instance
- **THEN** it SHALL complete, report p95 latency and error rate, and assert against defined thresholds

#### Scenario: Load test runs in CI

- **WHEN** a staging deployment completes
- **THEN** the load test SHALL be triggered and results reported (informational, not blocking)

### Requirement: E2E suite executes

The end-to-end test suite SHALL execute in full: every declared test SHALL run (zero skipped-by-error), the suite SHALL exit non-zero on failure, and it SHALL run in CI. The e2e module configuration SHALL resolve every workspace package to a single module identity (source aliases, not mixed `src`/`dist` resolution) so framework dependency injection cannot fail on duplicate class identities.

#### Scenario: All e2e tests run

- **WHEN** `pnpm test:e2e` executes
- **THEN** all declared tests SHALL run (0 skipped), and the command SHALL exit 0 on green

#### Scenario: Single class identity

- **WHEN** the e2e suite boots the application composition root
- **THEN** every workspace package SHALL be loaded from exactly one module identity, and injection SHALL resolve without duplicate-class errors

### Requirement: Golden expectations cite official sources

Every golden-dataset expected value SHALL be derived from the official rate table, and the golden fixtures SHALL carry a source-mapping comment table linking each expectation to its official vero.fi table row. Test expectations SHALL never be adjusted to match engine output; the engine is verified against the law, not against itself.

#### Scenario: Expectation provenance

- **WHEN** a golden expected excise value is reviewed
- **THEN** the fixture SHALL reference the official table row (category, band, effective period) it was computed from

#### Scenario: Rate change regenerates expectations deliberately

- **WHEN** a new tax-dataset version changes a rate
- **THEN** the golden expectations SHALL be regenerated and `GOLDEN_DATASET_VERSION` bumped in the same change, with the source-mapping table updated

### Requirement: Effective-range and band boundary tests

The tax-rule repository and engine SHALL be covered by boundary tests at every official band edge: ABV boundaries 0.5 / 2.8 / 5.5 / 8 / 15 / 18 on both sides, `effectiveTo` exactly equal to the calculation date, and adjacent intra-year effective ranges.

#### Scenario: Band edge both sides

- **WHEN** products at ABV just below and just above an official band boundary are calculated
- **THEN** the tests SHALL assert each resolves to its correct band's rate

#### Scenario: Expiry-date equality

- **WHEN** a calculation date equals a rule's `effectiveTo`
- **THEN** the test SHALL assert the rule still applies

### Requirement: Ranking methodology lockstep test

An automated test SHALL verify that the public ranking methodology output (`GET /api/v1/ranking/methodology`) is generated from the same source as the RankingService's actual sort behaviour, failing when either changes without the other.

#### Scenario: Methodology drift detected

- **WHEN** the RankingService's sort orders change without the methodology output changing (or vice versa)
- **THEN** the lockstep test SHALL fail

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


# mvp-testing — Delta Spec

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Golden-dataset regression tests

A fixed set of known product/transport/tax input combinations with manually verified expected outputs SHALL run on every deploy and every new tax-dataset version. Expected outputs SHALL be manually verified against official sources, not against the engine's current behaviour.

#### Scenario: Dataset version gate

- **WHEN** a new tax-dataset version is published
- **THEN** the golden-dataset tests SHALL pass against the manually verified expected outputs before the version ships

#### Scenario: Engine divergence caught

- **WHEN** an engine or data change produces a value that differs from the official-source-derived expectation
- **THEN** the golden test SHALL fail rather than being updated to match

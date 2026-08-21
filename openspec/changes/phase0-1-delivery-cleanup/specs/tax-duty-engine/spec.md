# tax-duty-engine — Delta Spec

## MODIFIED Requirements

### Requirement: Official dataset has an execution path

The official dataset (`SEED_RULES`) SHALL be seeded through a real execution path in every environment, and the seeding function SHALL detect per-version row-count mismatches: when a database already contains a version label but with a different number of rows than `SEED_RULES` defines for that label, the seed SHALL warn by default and SHALL fail in strict mode. Detection SHALL NOT mutate existing rows (append-only dataset policy: repair still requires a new labelled version or a data migration).

#### Scenario: Same-label correction is detected

- **WHEN** `seedTaxRules` runs against a database where a present version label has fewer or more rows than `SEED_RULES` defines
- **THEN** the result SHALL include a mismatch warning naming the label and both counts, and in strict mode the seed SHALL fail

#### Scenario: Complete version skips unchanged

- **WHEN** a database already contains every row of a version label
- **THEN** the seed SHALL skip that version with no warning and insert nothing for it

#### Scenario: Partially-populated version in strict mode

- **WHEN** strict mode is enabled and a version label is partially populated
- **THEN** the seed run SHALL fail before inserting, so drift surfaces at deploy time instead of silently persisting

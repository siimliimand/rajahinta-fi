## ADDED Requirements

### Requirement: Golden tests validate seeded official rates

The golden-dataset regression tests SHALL exercise the tax engines against the seeded tax-rule dataset, not against a repository that always returns null, and their expected outputs SHALL be derived from official Finnish Tax Administration rates.

#### Scenario: Golden tests use seed data

- **WHEN** the golden-dataset suite runs
- **THEN** the tax engines SHALL resolve rules from a seed-backed repository rather than always falling back to hardcoded constants

#### Scenario: Expected values match official rates

- **WHEN** a golden expected value changes because a fallback constant was incorrect
- **THEN** the value SHALL be re-derived from the official rate table and the dataset version SHALL be bumped

# guides-hub Specification

## MODIFIED Requirements

### Requirement: FAQ entries

The guides platform SHALL carry FAQ entries answering the standing visitor questions (landed cost meaning, price freshness, data sources, tax inclusion, legal bringing limits, accuracy, update cadence, account purpose). Entries SHALL be published through the existing ops guides flow in both locales, PUBLISHED status only, and linked from the homepage FAQ section.

#### Scenario: FAQ entries publish through the existing flow

- **WHEN** an operator publishes an FAQ entry via the ops guides console
- **THEN** the entry appears in the guides hub for its locale and becomes linkable from the homepage FAQ section

#### Scenario: Homepage links only published entries

- **WHEN** the homepage FAQ section renders
- **THEN** it lists only PUBLISHED FAQ entries and renders nothing when none exist

# product-normalization Specification Delta

## ADDED Requirements

### Requirement: Classification gate validates the enum

The classification gate SHALL validate `regulatoryClassification` against the known classification enum and SHALL reject placeholder values such as the literal string "unknown". Non-emptiness alone SHALL NOT pass the gate.

#### Scenario: Literal unknown rejected

- **WHEN** a record arrives with `regulatoryClassification: 'unknown'`
- **THEN** the gate SHALL reject the record

#### Scenario: Enum member accepted

- **WHEN** a record carries a classification that is a member of the known enum
- **THEN** the gate SHALL pass it

### Requirement: Source category normalization at ingestion

Ingestion SHALL normalize source-market category strings (for example Swedish "Öl", "Vin") to the canonical category keys the tax rules use, so gate-passing data is also tax-meaningful and live feeds do not fall into fallback rates.

#### Scenario: Swedish category mapped

- **WHEN** a Systembolaget record carries the Swedish category string for beer
- **THEN** the normalized record SHALL carry the canonical beer category the excise engine keys on

#### Scenario: Unmappable category handled

- **WHEN** a source category string has no canonical mapping
- **THEN** the record SHALL be flagged for the correction queue rather than silently assigned a fallback category

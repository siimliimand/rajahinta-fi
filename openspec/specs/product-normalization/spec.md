# product-normalization Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Cross-merchant deduplication

The system SHALL match the same physical product sold by multiple foreign retailers to one canonical Product Master with multiple linked Retail Offers.

#### Scenario: Duplicate listings

- **WHEN** two merchants list the same wine vintage in the same bottle size
- **THEN** normalization SHALL link both listings to one Product Master rather than creating two product records

### Requirement: Deterministic and fuzzy matching

Matching SHALL combine deterministic keys (GTIN/EAN barcode where available) with fuzzy matching on name, brand, volume, and ABV, and SHALL route low-confidence matches to a manual-review queue.

#### Scenario: Low-confidence match

- **WHEN** a new listing matches an existing product only at low confidence
- **THEN** the system SHALL queue the match for manual review rather than silently merging or duplicating

### Requirement: Regulatory classification gating

A canonical product SHALL carry a regulatory classification before it can appear in a landed-cost calculation. Unclassified products SHALL be excluded from calculator results and SHALL NOT be shown with a guessed classification.

#### Scenario: Unclassified product

- **WHEN** a product lacks a regulatory classification
- **THEN** the product SHALL be excluded from calculator results entirely

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

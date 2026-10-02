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

### Requirement: Pack-notation volume normalization

Ingestion normalization SHALL parse pack notation in product names (`N×V`, `N x V`, and comma-decimal variants such as `24×33 l`, `8×0,33 l`) and store the **per-unit** volume in `unit_volume`. A pack total SHALL never be stored as the unit volume: `24×33 l` normalizes to `unit_volume` 0.33 (litres per unit), not 33. Products whose names carry no pack notation SHALL be unchanged by this rule. The same module SHALL export the decisive pack SIZE (units per package) for downstream metric use — the `N×V` and `V×N` notation orders (e.g. `24×33 l`, `33CL x 24`) and the `N-pack` name form (e.g. `8-pack tölkki`) each read the pack count; a name admitting no decisive count (e.g. `Karhu 4,6 tölkki`) SHALL yield nothing rather than a guess. The exported count is a read-time derivation consumed by the €/g metric (spec unit-price-metrics) and SHALL NOT be persisted as a column. Existing rows whose stored `unit_volume` disagrees with the parsed pack notation SHALL be correctable by a one-time operator-run backfill script (with `--stats`, `--sample`, and `--dry-run` modes) that regenerates the same normalized values deterministically; because `unit_volume` participates in the Tier-2 identity compound key, the runbook SHALL pin backfill-before-deploy ordering.

#### Scenario: Pack notation normalizes per unit

- **WHEN** a feed row's name is `Karhu Olut 5.3% 24×33 l`
- **THEN** ingestion stores `unit_volume` 0.33 (litres per can), not 33

#### Scenario: Comma-decimal pack variant

- **WHEN** a product name contains `8×0,33 l`
- **THEN** the stored `unit_volume` is 0.33

#### Scenario: Decisive pack size exported for metric use

- **WHEN** a product name is `Karhu Olut 5.3% 24×33 l`, `33CL x 24`, or `8-pack tölkki`
- **THEN** the exported pack size is 24, 24, and 8 respectively — derived from the name alone, both notation orders covered, no volume token required for the count — and `Karhu 4,6 tölkki` exports no count (null), never a guessed one

#### Scenario: Non-pack names unchanged

- **WHEN** a product name has no pack notation (e.g. `Jameson Caskmates 40% 0,7 l`)
- **THEN** the stored `unit_volume` is identical to the pre-change mapping output

#### Scenario: Backfill corrects stored corruption deterministically

- **WHEN** the backfill script runs with `--dry-run` against rows with pack-notation names and stored pack totals
- **THEN** every proposed update equals the value the normalizer would store on re-ingestion, and no row outside the pack-notation/zero/absurd-volume candidate set is touched

# Spec Delta: product-normalization

## MODIFIED Requirements

### Requirement: Source category normalization at ingestion

Ingestion SHALL normalize source-market category strings (for example Swedish "Öl", "Vin") to the canonical category keys the tax rules use, so gate-passing data is also tax-meaningful and live feeds do not fall into fallback rates. The fermented-beverage bucket SHALL be capped at the EU intermediate-products boundary: a product above 22 % ABV SHALL NOT normalize to `other_fermented` — spirit-family source categories (bitter, snaps, akvavit/aquavit, sambuca, arrak, and their market-language spellings) SHALL map to `spirits`, and a source string with no explicit mapping on an above-boundary product SHALL normalize to `spirits` under the boundary rule rather than to a fermented bucket. The excise engine's raw-category normalization SHALL apply the same boundary: an unrecognized raw category on a product above 22 % ABV SHALL resolve to the spirits duty key, never to a fermented key. The boundary is taxonomy law, not a heuristic guess.

#### Scenario: Swedish category mapped

- **WHEN** a Systembolaget record carries the Swedish category string for beer
- **THEN** the normalized record SHALL carry the canonical beer category the excise engine keys on

#### Scenario: Unmappable category handled

- **WHEN** a source category string has no canonical mapping
- **THEN** the record SHALL be flagged for the correction queue rather than silently assigned a fallback category

#### Scenario: Spirit-family keywords map to spirits

- **WHEN** a product carries a bitter, snaps, akvavit/aquavit, sambuca, or arrak family source category at any ABV
- **THEN** the normalized record SHALL carry the canonical spirits category

#### Scenario: Fermented bucket is capped by ABV

- **WHEN** a product above 22 % ABV normalizes from a source category whose keyword maps to the fermented bucket
- **THEN** the record SHALL carry the canonical spirits category, and the re-assignment SHALL be attributable to the boundary rule in review output

#### Scenario: Tax engine fallback cannot produce a fermented key above the boundary

- **WHEN** the excise engine normalizes an unrecognized raw category string for a product above 22 % ABV
- **THEN** the duty key SHALL resolve to spirits, and the per-litre-of-product fermented formula SHALL NOT apply

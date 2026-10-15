# product-normalization Specification

## ADDED Requirements

### Requirement: Name informativeness gate at ingestion

Ingestion SHALL classify every product display name with an informativeness test: a name that is empty after trimming, or whose remaining alphabetic content is shorter than 3 characters after ABV percentages, volumes, pack notations, and bare numeric tokens are stripped, SHALL be stored with the quarantined quality status. Quarantined products SHALL be excluded from the default public catalog, search results, the unit-price ranking, and savings candidate sets, and SHALL remain visible in the operator console with the raw feed name for enrichment. The raw feed name SHALL be preserved unchanged whenever the display name is transformed or the product is quarantined.

#### Scenario: Token-only name is quarantined

- **WHEN** a feed row's name is "40 %" or "70 cl"
- **THEN** the product is stored quarantined, excluded from default public listings, and visible in the operator console with the raw name

#### Scenario: Informative names pass unchanged

- **WHEN** a feed row's name carries at least 3 alphabetic characters beyond ABV/volume/numeric tokens
- **THEN** the product is stored with the ok quality status and appears in default public listings as before

#### Scenario: Empty name is quarantined

- **WHEN** a feed row's name is empty or whitespace
- **THEN** the product is stored quarantined with the empty raw name preserved

### Requirement: Merchant annotation stripping

Ingestion SHALL strip parenthetical merchant-side commentary (availability notes, per-customer purchase limits, rarity or restock remarks) from the display name and store the stripped text as annotation metadata. The display name SHALL NOT contain merchant availability commentary. The transformation SHALL be deterministic: the same input name always yields the same display name and annotation.

#### Scenario: Availability note is stripped into metadata

- **WHEN** a feed row's name is "Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)"
- **THEN** the display name is "Glenfarclas 70 Year Old Single Malt" and the annotation metadata carries "saatavuus 1 plo"

#### Scenario: Names without commentary are untouched

- **WHEN** a feed row's name contains no parenthetical commentary
- **THEN** the display name equals the feed name

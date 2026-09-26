# data-acquisition Specification

## ADDED Requirements

### Requirement: Feed record mapping

`DataMappingService.mapToProductAndOffer` SHALL convert source millilitres to litres before persisting `unitVolume`, and SHALL decode HTML entities (named and numeric, e.g. `&#038;`, `&amp;`, `&#8221;`, `&#215;`) in source-provided `productName` and `brand` strings before persisting them. Persisted display text SHALL contain no undecoded entities; render-time output escaping SHALL remain unchanged.

#### Scenario: Millilitre source value lands as litres

- **WHEN** a feed record with `volumeMl = 750` is mapped
- **THEN** the persisted `unitVolume` is `"0.75"`

#### Scenario: Encoded catalog names are stored decoded

- **WHEN** a feed record's product name contains `&#038;` or `&#8221;`
- **THEN** the persisted name contains `&` or the typographic quote respectively and no entity literal

#### Scenario: Entity decoding does not double-decode or corrupt plain text

- **WHEN** a product name contains no entities (or already-decoded ampersands)
- **THEN** the persisted name is byte-identical to the source name

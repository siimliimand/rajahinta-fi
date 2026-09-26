# unit-price-metrics Specification

## MODIFIED Requirements

### Requirement: Ethanol grams derive from canonical litres

The €/g ethanol computation SHALL derive `ethanolGrams` from the product's unit volume in litres (canonical `product_master` convention) multiplied by the ABV fraction and the ethanol density constant. Values computed from a mis-scaled unit volume (millilitre rows read as litres) SHALL NOT be served; rows failing the plausibility window SHALL be omitted or statused UNAVAILABLE, never published as rankings.

#### Scenario: Gram figure matches hand calculation

- **WHEN** a 24 × 0.33 l beer case at 5.3 % ABV is scored
- **THEN** the reported ethanol grams are in the hundreds (≈ 420 g), not hundreds of thousands

#### Scenario: Implausible unit volumes never rank

- **WHEN** a row's underlying unit volume violates the `0 < unit_volume < 100` window
- **THEN** the row is omitted from the ranking (or UNAVAILABLE), consistent with the unavailable-omitted contract

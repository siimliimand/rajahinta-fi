# transport-estimation Specification

## ADDED Requirements

### Requirement: Known-weight preference

Transport estimation SHALL use the product's stored weight when the product master carries one, and SHALL fall back to the existing volume-based estimate when it does not. The chosen basis SHALL be visible in the estimation result so the carrier-rate lookup that consumes it is explainable.

#### Scenario: Stored weight used

- **WHEN** a product's master row has `weight_grams = 530`
- **THEN** the carrier-rate lookup for that product uses 0.53 kg and the result states the weight basis is the stored product weight

#### Scenario: No stored weight

- **WHEN** a product has no stored weight
- **THEN** the estimation falls back to the volume-based estimate, marks the basis as estimated, and the result is unchanged in shape

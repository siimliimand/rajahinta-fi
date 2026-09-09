# transport-estimation Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Transport offer model

The system SHALL maintain transport offers by carrier, route, destination, weight tier, and package tier, each with a seller-involvement indicator distinguishing retailer-arranged from independent-carrier transport.

#### Scenario: Single-item estimate

- **WHEN** a user requests a landed-cost calculation for one product
- **THEN** the Transport Estimation module SHALL return an estimated shipping cost based on the matching offer for that item's weight and package tier

### Requirement: Basket-level estimation

Shipping estimation SHALL operate at the basket level (one or more products, quantities, total weight/volume) because thresholds and incremental charges are non-linear.

#### Scenario: Non-linear shipping threshold

- **WHEN** a basket crosses a weight or package threshold
- **THEN** the estimate SHALL reflect the corresponding tier rather than summing per-item costs

### Requirement: Transport arrangement classification

The module SHALL distinguish retailer-arranged transport from independent-carrier transport, and SHALL expose this distinction to the Transaction Classification Module.

#### Scenario: Classification input

- **WHEN** a merchant arranges and books the carrier itself
- **THEN** the transport arrangement SHALL be recorded as retailer-arranged and passed to Transaction Classification as an input

### Requirement: Unified single-line shipment selection

A consolidated shipment containing a single product line SHALL resolve to the same transport offer and cost that the single-item estimate returns for the same product, quantity, route, and transport method, so that basket-level and single-item estimation never disagree for identical inputs.

#### Scenario: Single-line basket matches single-item estimate

- **WHEN** a basket shipment contains one product line and the single-item estimate is requested for the same product, quantity, and route
- **THEN** both paths SHALL select the same transport offer and return the same cost and reliability status

### Requirement: Known-weight preference

Transport estimation SHALL use the product's stored weight when the product master carries one, and SHALL fall back to the existing volume-based estimate when it does not. The chosen basis SHALL be visible in the estimation result so the carrier-rate lookup that consumes it is explainable.

#### Scenario: Stored weight used

- **WHEN** a product's master row has `weight_grams = 530`
- **THEN** the carrier-rate lookup for that product uses 0.53 kg and the result states the weight basis is the stored product weight

#### Scenario: No stored weight

- **WHEN** a product has no stored weight
- **THEN** the estimation falls back to the volume-based estimate, marks the basis as estimated, and the result is unchanged in shape


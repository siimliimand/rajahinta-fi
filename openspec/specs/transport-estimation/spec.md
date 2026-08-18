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


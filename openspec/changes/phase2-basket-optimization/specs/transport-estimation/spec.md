# transport-estimation Specification

## ADDED Requirements

### Requirement: Unified single-line shipment selection

A consolidated shipment containing a single product line SHALL resolve to the same transport offer and cost that the single-item estimate returns for the same product, quantity, route, and transport method, so that basket-level and single-item estimation never disagree for identical inputs.

#### Scenario: Single-line basket matches single-item estimate

- **WHEN** a basket shipment contains one product line and the single-item estimate is requested for the same product, quantity, and route
- **THEN** both paths SHALL select the same transport offer and return the same cost and reliability status

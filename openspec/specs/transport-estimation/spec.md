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

A consolidated shipment containing a single product line SHALL resolve to the same transport offer and cost that the single-item estimate returns for the same product, quantity, route, and transport method, so that basket-level and single-item estimation never disagree for identical inputs. Both paths SHALL share the same resolution machinery: the carrier resolves through transport method, registry carrier assignment, then the merchant fallback; the shipping tier derives from the total shipment weight against the carrier's own bracket ceilings (never from the product's container material — the estimator accepts a legacy containerType argument for call-site compatibility and never consults it); and the bracket match runs on the total shipment weight, the resolved per-unit weight times the requested quantity.

#### Scenario: Single-line basket matches single-item estimate

- **WHEN** a basket shipment contains one product line and the single-item estimate is requested for the same product, quantity, and route
- **THEN** both paths SHALL select the same transport offer and return the same cost and reliability status

#### Scenario: Quantity scales the bracket

- **WHEN** a user requests a landed-cost calculation for 12 units of a 1 kg product and the carrier prices 10–12 parcel shipments as one bracket
- **THEN** the estimator selects that bracket and returns its price, not the single-parcel price

#### Scenario: Tier follows weight, not container material

- **WHEN** the shipment weight exceeds the carrier's largest parcel bracket ceiling
- **THEN** the estimator matches within the carrier's pallet tier instead of comparing the product's container material to shipping tiers

#### Scenario: Legacy containerType argument is ignored

- **WHEN** a call site passes the product's container material in the estimator's legacy argument slot
- **THEN** the tier still derives from the shipment weight and the result matches the equivalent call without the legacy argument

### Requirement: Known-weight preference

Transport estimation SHALL use the product's stored weight when the product master carries one, and SHALL fall back to the existing volume-based estimate when it does not. The chosen basis SHALL be visible in the estimation result so the carrier-rate lookup that consumes it is explainable.

#### Scenario: Stored weight used

- **WHEN** a product's master row has `weight_grams = 530`
- **THEN** the carrier-rate lookup for that product uses 0.53 kg and the result states the weight basis is the stored product weight

#### Scenario: No stored weight

- **WHEN** a product has no stored weight
- **THEN** the estimation falls back to the volume-based estimate, marks the basis as estimated, and the result is unchanged in shape

### Requirement: Carrier assignment resolution

The landed-cost calculation SHALL resolve the transport carrier once per estimate — an explicitly requested transport method first, then the offering merchant's registry carrier assignment (`carrier_id`), then the merchant identifier itself as the honest last resort — and the resolved carrier SHALL feed the single-item estimate and the single-line basket path alike. Carrier identifiers SHALL be normalized (trimmed, lowercased) at the estimator's domain boundary before the offer query, so casing or stray whitespace in the fallback never loses a match. A merchant with no carrier assignment and no requested transport method SHALL produce the existing UNAVAILABLE transport degradation, never a guessed carrier.

#### Scenario: Assigned carrier wins

- **WHEN** the offering merchant's registry row carries `carrier_id = 'fransberg'` and the caller names no transport method
- **THEN** the estimator queries offers for carrier `fransberg`, regardless of the merchant name's casing

#### Scenario: Explicit transport method still wins

- **WHEN** the caller supplies a transport method while the offering merchant carries a different registry assignment
- **THEN** the lookup uses the caller-supplied transport method

#### Scenario: Unassigned merchant stays honest

- **WHEN** the offering merchant's registry row has no carrier assignment and the caller supplies no transport method
- **THEN** the transport line degrades to 0 ¢ UNAVAILABLE exactly as when the carrier table has no rows

### Requirement: Honest transport verification

An exact weight-bracket match SHALL yield VERIFIED only when the lookup weight basis is the stored product weight (a positive stored weight stood behind the lookup); every other outcome SHALL cap the transport reliability at ESTIMATED — an exact bracket matched on the volume-based weight estimate, or a closest-bracket fallback on any basis. The rule SHALL be downgrade-only: no monetary figure may change because of it, and the result SHALL state which weight basis stood behind the lookup.

#### Scenario: Exact bracket on stored weight

- **WHEN** the bracket match is exact and the product master carries a positive `weight_grams`
- **THEN** the transport line reports VERIFIED and the calculator's confidence may rise above LOW

#### Scenario: Exact bracket on estimated weight

- **WHEN** the bracket match is exact but the lookup used the volume-based weight estimate
- **THEN** the transport line reports ESTIMATED, and no price or total differs from the stored-weight case

#### Scenario: Closest bracket never verifies

- **WHEN** no bracket boundary coincides with the lookup weight and the closest-midpoint bracket is selected, even on a stored product weight
- **THEN** the transport line reports ESTIMATED

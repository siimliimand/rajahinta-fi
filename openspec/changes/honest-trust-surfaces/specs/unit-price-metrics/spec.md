# unit-price-metrics Specification

## MODIFIED Requirements

### Requirement: Price per gram of pure ethanol

The system SHALL compute a unit price in euro per gram of pure ethanol for every product offer as price divided by the product of unit volume in litres, alcohol fraction, and ethanol density (789 g/l). The metric SHALL be derived at read time from stored offer and product fields and SHALL NOT be persisted as a column. The unavailability reason set SHALL distinguish zero ethanol (`ZERO_ETHANOL` — the alcohol fraction is present and equals 0, so the denominator is zero and the metric is physically undefined) from invalid input (`INVALID_ALCOHOL_FRACTION`, `INVALID_VOLUME`, `INVALID_PRICE` — the value is unusable data) and from missing input (`MISSING_VOLUME`, `MISSING_ALCOHOL_FRACTION` — known unknowns report before value-level faults).

#### Scenario: Metric computed from complete inputs

- **WHEN** an offer has a price and the product has both unit volume and alcohol percentage
- **THEN** the API SHALL return the €/g value computed by the pure function, with the offer's price reliability status attached

#### Scenario: Missing alcohol data

- **WHEN** a product has no alcohol percentage
- **THEN** the metric SHALL be reported as unavailable with an explicit status, and no value SHALL be silently substituted

#### Scenario: Alcohol-free product is zero-ethanol, not invalid

- **WHEN** a product's alcohol percentage is present and equals 0 (e.g. a 0,0% beer)
- **THEN** the metric SHALL be reported unavailable with reason `ZERO_ETHANOL`, and SHALL NOT report `INVALID_ALCOHOL_FRACTION`

## ADDED Requirements

### Requirement: Listing embed derives from a single current offer

Product listing rows SHALL embed `eurPerGram` computed from the **cheapest current-available single offer** for the product — a real offer's price and its price reliability status, resolved with the same freshness and availability semantics the product-detail endpoint uses. The embed SHALL NOT be derived from any multi-offer aggregate value (a minimum's identity as one specific offer is what makes the derivation honest; aggregates as aggregates remain banned as metric inputs). The embed SHALL be unavailable — with the domain's explicit reason — when the product has no current-available offer or its physical inputs are missing, invalid, or zero-ethanol. Listing embeds SHALL NOT reorder results, feed ranking, or alter any calculation input.

#### Scenario: Listing embed matches the cheapest current detail offer

- **WHEN** a product's detail endpoint lists a current-available offer with the lowest price P and provenance R
- **THEN** the listing row's `eurPerGram` equals the metric computed from P, labeled with reliability R

#### Scenario: No current offer stays honestly unavailable

- **WHEN** a product has no current-available offer (stale or unavailable rows only)
- **THEN** the listing embed reports unavailable with an explicit reason, never a value derived from a stale price presented as current

#### Scenario: Sort receives real embeds

- **WHEN** the compare page orders products by €/g
- **THEN** products with a computed listing embed order by metric value (id tiebreaker), and only products without one sort last — the order is no longer a universal id-order no-op

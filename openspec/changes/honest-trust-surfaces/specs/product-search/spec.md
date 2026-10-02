# product-search Specification

## MODIFIED Requirements

### Requirement: Offer aggregates populated on the listing

Listing items SHALL carry `lowestPriceCents` and `merchantCount` aggregated from the product's retail offers, plus the `eurPerGram` embed derived from the cheapest current-available single offer per spec unit-price-metrics (single-offer derivation, provenance labeled, explicit unavailability). A product with no offers SHALL carry a null price and a zero merchant count rather than a guessed value, and its `eurPerGram` embed SHALL be unavailable.

#### Scenario: Product with offers

- **WHEN** a listed product has offers from multiple merchants
- **THEN** the item SHALL carry the lowest offer price in EUR cents and the distinct merchant count

#### Scenario: Product without offers

- **WHEN** a listed product has no retail offers
- **THEN** `lowestPriceCents` SHALL be null and `merchantCount` SHALL be 0

#### Scenario: Embed present on ordinary rows

- **WHEN** a listed product has a current-available offer and complete physical inputs
- **THEN** the item's `eurPerGram` embed carries `status: computed` with a finite cents-per-gram value — no listing path may force the price input to NaN

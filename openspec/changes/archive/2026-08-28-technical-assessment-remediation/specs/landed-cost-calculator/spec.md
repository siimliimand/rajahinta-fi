# landed-cost-calculator Specification Delta

## ADDED Requirements

### Requirement: Single-currency totals

The landed-cost calculator SHALL sum only EUR-converted cents produced by recorded conversions. Offers without a valid conversion SHALL be excluded from the calculation with a visible exclusion reason on the result. The original amount and currency of each offer SHALL remain available for display.

#### Scenario: Unconvertible offer excluded visibly

- **WHEN** an offer without a valid conversion would otherwise enter a calculation
- **THEN** the result SHALL exclude it and list the exclusion reason rather than produce a mixed-currency total

## REMOVED Requirements

### Requirement: otherCharges placeholder

The `otherCharges` field is removed from the calculation result API shape. It was hardcoded to zero and constitutes a dead contract; if a real other-charges source is introduced later, the field returns with defined semantics.

#### Scenario: Field absent from results

- **WHEN** any calculation result is serialized
- **THEN** the payload SHALL NOT contain an `otherCharges` key

# savings-discovery Specification

## MODIFIED Requirements

### Requirement: Market overview aggregates

The savings surface SHALL present a market-overview section with deterministic aggregates computed over observed data: average observed price per beverage category, the largest observed cross-border difference (with ties broken deterministically), and the count of observed products. Selection and ordering SHALL use objective criteria only; no editorial or commercial weighting SHALL affect any figure.

#### Scenario: Aggregates are objective and deterministic

- **WHEN** the market overview renders
- **THEN** each figure derives from observed data through a fixed, reproducible computation, and repeated renders with unchanged data produce identical output

#### Scenario: Insufficient data degrades gracefully

- **WHEN** a category lacks sufficient observations
- **THEN** that category's figure is omitted rather than estimated or zero-filled

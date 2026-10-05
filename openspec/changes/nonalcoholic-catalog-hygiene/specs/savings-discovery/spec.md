# savings-discovery Delta

## MODIFIED Requirements

### Requirement: Market overview aggregates

The savings surface SHALL present a market-overview section with deterministic aggregates computed over observed data: average observed price per beverage category, the largest observed cross-border difference (with ties broken deterministically), and the count of observed products. Selection and ordering SHALL use objective criteria only; no editorial or commercial weighting SHALL affect any figure. The aggregate product universe SHALL be the same shared listing universe as the catalog: non-alcoholic rows (zero or unknown ABV in an alcohol category) and rows held for review SHALL NOT contribute to any average, difference, or count.

#### Scenario: Aggregates are objective and deterministic

- **WHEN** the market overview renders
- **THEN** each figure derives from observed data through a fixed, reproducible computation, and repeated renders with unchanged data produce identical output

#### Scenario: Insufficient data degrades gracefully

- **WHEN** a category lacks sufficient observations
- **THEN** that category's figure is omitted rather than estimated or zero-filled

#### Scenario: Non-alcoholic rows never headline a category

- **WHEN** the largest-difference figure is selected for a category
- **THEN** the selected product contains alcohol (ABV greater than zero, no review hold), and a zero-ABV row can never appear as the category's largest observed difference

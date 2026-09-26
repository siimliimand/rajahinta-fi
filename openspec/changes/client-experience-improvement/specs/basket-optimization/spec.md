# basket-optimization Specification

## ADDED Requirements

### Requirement: Event-scale basket capacity

The basket optimizer SHALL accept up to 30 distinct items (`MAX_BASKET_ITEMS = 30`). The total-combinations guard SHALL continue to bound the search and answer 422 when exceeded, so the raised cap never produces unbounded runtimes. The basket UI SHALL show a progress indicator ("12/30") so the limit is visible before it is hit.

#### Scenario: Thirty items optimize

- **WHEN** a basket with 30 distinct items is submitted for optimization
- **THEN** the optimizer returns a result and no cap error occurs

#### Scenario: Thirty-first item is rejected with a bounded error

- **WHEN** a basket with 31 distinct items is submitted
- **THEN** the API responds 422 naming the item cap, and the response time of valid requests stays bounded by the combinations guard

#### Scenario: Progress indicator shows the cap

- **WHEN** a basket holds 12 items
- **THEN** the basket UI displays "12/30" (localized) near the item list

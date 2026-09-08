# allowance-fill-planner Specification

## ADDED Requirements

### Requirement: Allowance-constrained basket fill

An authenticated user SHALL be able to request a basket fill for a trip route: given the traveller allowance limit effective on the travel date, resolved from the versioned traveller-allowance datasets with effective-date resolution, the system SHALL return a basket of products and quantities whose total duty-free value fits within that limit, selected by bounded exhaustive search. The response SHALL mirror the basket optimize result shape, itemizing each line with its contribution and the remaining headroom.

#### Scenario: Fill within allowance

- **WHEN** a fill is requested for a route, travel date, and product candidate set
- **THEN** the returned basket total SHALL NOT exceed the resolved allowance limit and every line SHALL itemize its value contribution

#### Scenario: Allowance resolved by date

- **WHEN** the travel date falls under a different allowance dataset version than today
- **THEN** the limit SHALL resolve from the version effective on the travel date, and the response SHALL name the dataset version used

### Requirement: Explainable selection

Every fill result SHALL be traceable to the candidate offers, the allowance dataset version, and the search bounds that produced it, consistent with the platform's every-number-is-explainable invariant.

#### Scenario: Result carries provenance

- **WHEN** a fill result is returned
- **THEN** it SHALL identify the allowance dataset version, the candidate offer set, and the search bounds used

### Requirement: Ferry offers stay display-only

The fill response MAY include the curated ferry-offer block in its own separate section. Ferry offers SHALL NOT participate in the fill computation, and the fill result SHALL be byte-identical whether zero, one, or many ferry-offer rows exist.

#### Scenario: Ferry section isolated

- **WHEN** the fill computation runs with any number of ferry offers present
- **THEN** the basket selection and all computed figures SHALL be identical, with ferry offers confined to their separate display section

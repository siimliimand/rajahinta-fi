# basket-optimization Specification

## Purpose
TBD - created by archiving change phase2-basket-optimization. Update Purpose after archive.
## Requirements
### Requirement: Multi-item basket optimization

Given a basket of products with quantities and a destination, the system SHALL evaluate single-store purchases and multi-store splits, accounting for minimum-order thresholds, weight brackets, package tiers, and shipping increments, and SHALL return the combination with the lowest total estimated landed cost together with neutral cost-ordered alternatives. Traveller-import (PERSONAL) arrangements SHALL evaluate single-store combinations only.

#### Scenario: Cheapest split across stores found

- **WHEN** a basket's lowest total requires buying different items from different stores because of shipping tiers or minimum-order thresholds
- **THEN** the optimizer SHALL return that multi-store combination as the recommended result

#### Scenario: Single-store purchase wins

- **WHEN** buying the entire basket from one store produces the lowest total
- **THEN** the optimizer SHALL return the single-store combination, with one consolidated shipment

#### Scenario: Personal transport limited to single store

- **WHEN** the transport arrangement is PERSONAL
- **THEN** the optimizer SHALL evaluate single-store combinations only and SHALL NOT propose multi-store splits

### Requirement: Bounded deterministic search

The search SHALL exhaustively enumerate item-to-merchant assignments within explicit caps (maximum distinct items and maximum candidate merchants per item), SHALL reject requests exceeding the caps with a validation error before any computation, and SHALL break ties deterministically (lower total, then fewer stores, then lexicographic merchant order). The optimizer input SHALL contain no commercial or billing signal of any kind.

#### Scenario: Caps enforced

- **WHEN** a request exceeds the item or candidate cap
- **THEN** the system SHALL reject it with a validation error and SHALL perform no search

#### Scenario: Deterministic tie-breaking

- **WHEN** two combinations produce identical totals
- **THEN** the optimizer SHALL order them by fewer stores first, then by lexicographic merchant order, producing the same ordering on every run for the same inputs

#### Scenario: No commercial signal in input

- **WHEN** the optimizer is invoked
- **THEN** its input and result ordering SHALL depend only on objective cost, quantity, transport, and tax data, with no code path reading billing or promotion state

### Requirement: Consistency with the single-item calculator

The optimizer SHALL compute per-item costs through the same tax, duty, transport, classification, and confidence code paths as the single-item Landed-Cost Calculator, such that an optimizer result for a single product, single store, and identical inputs never differs from the calculator's result.

#### Scenario: Single-item equivalence

- **WHEN** the optimizer evaluates a basket of one product from one store with the same quantity, destination, and transport assumption as a calculator run
- **THEN** every cost component and the total SHALL equal the calculator's result for the same tax-dataset and transport-dataset versions

### Requirement: Minimum-order threshold feasibility

The optimizer SHALL treat a store as infeasible for an assignment when the store's verified minimum-order threshold exceeds the store's order subtotal. When threshold data is missing or not VERIFIED, the store SHALL remain eligible and the result confidence SHALL be downgraded accordingly; threshold status SHALL never be silently assumed.

#### Scenario: Verified threshold blocks a store

- **WHEN** an assignment's store subtotal is below that store's VERIFIED minimum-order threshold
- **THEN** the optimizer SHALL exclude that assignment from the search results

#### Scenario: Unverified threshold downgrades confidence

- **WHEN** a result relies on a merchant whose threshold data is ESTIMATED or STALE
- **THEN** the result SHALL remain eligible but carry a downgraded confidence level with evidence naming the threshold input

### Requirement: Explainable result with structural disclaimer

Every optimizer result SHALL carry per-shipment itemized breakdowns (retail, transport, excise, container duty) with per-input reliability statuses and timestamps, dataset versions, an aggregated confidence level, and the standing disclaimer ("estimated total cost in Finland, not final legal tax liability") as a structural part of the result object.

#### Scenario: Every figure traceable

- **WHEN** a user views an optimizer result
- **THEN** each figure SHALL be traceable to its input values, dataset version, and timestamp, at shipment and item granularity

#### Scenario: Disclaimer carried structurally

- **WHEN** an optimizer result is serialized for any consumer
- **THEN** the disclaimer SHALL be present in the result object itself

### Requirement: Basket optimization API

The system SHALL expose `POST /api/v1/basket/optimize` accepting the basket (product IDs and quantities), destination, and transport arrangement. The endpoint SHALL validate input (item cap, quantity bounds, destination format), SHALL be rate-limited, SHALL be gated behind the `enable_basket_optimization` feature flag, and SHALL return idempotent results for identical inputs while dataset versions are unchanged.

#### Scenario: Valid optimization request

- **WHEN** a client submits a valid basket within the caps
- **THEN** the system SHALL return the recommended combination, neutral alternatives, per-shipment breakdowns, confidence, and disclaimer

#### Scenario: Flag off blocks access

- **WHEN** the `enable_basket_optimization` flag is disabled
- **THEN** the endpoint SHALL not serve optimization results

#### Scenario: Idempotent replay

- **WHEN** the same basket request is repeated while dataset versions are unchanged
- **THEN** the system SHALL return the same result without recomputation

### Requirement: Input caps pinned by test

A test SHALL pin the optimizer's input caps (items per basket, merchants per item) so a cap change is a deliberate, visible act rather than silent drift.

#### Scenario: Cap change fails the pin

- **WHEN** a cap constant is altered without updating the pinning test
- **THEN** the test suite SHALL fail

### Requirement: Total combinations guard

The optimizer SHALL guard on total combination count before enumerating, returning a clean 422 with an explanatory error when the request exceeds the configured bound, rather than exhausting CPU or memory.

#### Scenario: Oversized request rejected

- **WHEN** a basket request's total combinations exceed the configured bound
- **THEN** the API SHALL return 422 with an explanation and SHALL NOT enumerate the combinations

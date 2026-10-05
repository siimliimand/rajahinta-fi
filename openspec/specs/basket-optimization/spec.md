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

### Requirement: Sticky basket summary

On desktop viewports the basket page SHALL render a summary card that stays visible while the basket is edited: Finland total, cross-border total, estimated difference, and (when trip costs are present) the net difference after trip costs.

#### Scenario: Summary persists during editing

- **WHEN** the visitor adds, removes, or edits basket rows on a desktop viewport
- **THEN** the summary card remains visible and its totals reflect the current basket

### Requirement: Event-scale basket capacity

The basket optimizer SHALL accept up to 30 distinct items (`MAX_BASKET_ITEMS = 30`). The total-combinations guard SHALL continue to bound the whole optimization (the DFS search and any per-merchant shipping prefetch) and answer 422 when exceeded, so the raised cap never produces unbounded runtimes. The basket UI SHALL show a progress indicator ("12/30") so the limit is visible before it is hit.

#### Scenario: Thirty items optimize

- **WHEN** a basket with 30 distinct items is submitted for optimization
- **THEN** the optimizer returns a result and no cap error occurs

#### Scenario: Thirty-first item is rejected with a bounded error

- **WHEN** a basket with 31 distinct items is submitted
- **THEN** the API responds 400 (ValidationError) naming the item cap — matching the existing validation contract, with 422 reserved for the combinations guard — and the response time of valid requests stays bounded by the combinations guard

#### Scenario: Progress indicator shows the cap

- **WHEN** a basket holds 12 items
- **THEN** the basket UI displays "12/30" (localized) near the item list

### Requirement: Localized basket result presentation

The basket optimization result SHALL render every cost-line label and reliability-explanation sentence in the active locale. The optimization API SHALL carry an additive, closed-set machine-readable `code` on each cost line alongside the existing English `label`, which SHALL remain byte-identical on the wire for API consumers. The basket result (and the share snapshot rendering of a basket) SHALL compose labels and explanation sentences from the locale's message catalog using the `code`, and SHALL fall back to the verbatim API label for any line whose code is unknown. Localization SHALL NOT alter any cost figure, reliability status, confidence value, ranking outcome, or the recommended combination.

#### Scenario: Finnish locale renders Finnish line labels

- **WHEN** a basket optimization result is rendered under the `fi` locale
- **THEN** every cost line renders its Finnish label (e.g. "Vähittäishinta", "Alkoholivalmistevero") composed from the line's `code`, and no English line label appears

#### Scenario: Reliability explanations render in the active locale

- **WHEN** the result's data-reliability section is rendered under the `fi` locale
- **THEN** each explanation sentence is composed in Finnish from the input's dimension and status, and no English sentence appears

#### Scenario: Unknown codes fall back to the API label

- **WHEN** a result carries a cost line whose `code` is not in the closed set
- **THEN** the line renders the verbatim API `label`, and all amounts remain byte-identical

#### Scenario: Wire contract is additive only

- **WHEN** the optimization API response is serialized
- **THEN** each cost line carries its new `code` while the existing `label` and every monetary figure remain byte-identical to their previous values

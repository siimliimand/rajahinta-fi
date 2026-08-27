## Why

The Phase 1 calculator handles one product at a time. Real purchase decisions are baskets: several products bought from one or more foreign stores, where shipping is non-linear (weight brackets, package tiers, shipping increments, minimum-order thresholds), so the cheapest basket often splits across stores. Task 2B in `docs/tasks.md` (T2.6 through T2.9) closes that gap.

Most of the machinery already exists: per-merchant retail offers, the tax and duty engines, `BasketShippingCalculator` (weight brackets, package tiers, threshold checks), the confidence framework, feature flags, and version-aware idempotency caching. Missing pieces: a per-merchant calculation path (the calculator currently selects the single lowest offer internally), minimum-order threshold data, the combinatorial search over store combinations, a basket API, and the UI.

## What Changes

- **Shared item-cost core**: extract an offer-constrained computation path from `LandedCostCalculatorService` so a landed cost can be computed for a specific merchant offer through the same engine steps. Calculator and optimizer results never diverge for the same inputs (T2.8), enforced by a consistency regression test.
- **Basket optimizer module** (`core-domain/optimizer/`): exhaustive bounded search over item-to-merchant assignments; per-store grouping with one consolidated shipment per store; minimum-order feasibility checks; deterministic tie-breaking (fewest stores, then lexicographic merchant order). Neutrality: the optimizer input carries zero commercial signals and alternatives are ordered by total cost only.
- **Merchant terms**: new `merchantTerms` table storing the minimum-order value per merchant with reliability status and timestamp, following the rule that every externally sourced fact carries provenance. Absence of a row means no known threshold; a non-VERIFIED threshold downgrades result confidence, never silently assumed.
- **Persistence**: new `basketCalculationRecords` table storing the input basket, per-shipment breakdown, total, confidence, and the structural disclaimer.
- **API**: `POST /api/v1/basket/optimize` with input validation (item and quantity caps), rate limiting, the `enable_basket_optimization` feature flag, and version-aware idempotent caching.
- **UI**: basket builder and optimization results page; multi-store comparison view on the compare page. Both behind the feature flag.
- **PERSONAL transport arrangement**: optimizer evaluates single-store combinations only; multi-store personal carry is out of scope.

## Capabilities

### New Capabilities
- `basket-optimization`: Given a multi-item basket, evaluate single-store purchase and multi-store splits (minimum-order thresholds, weight brackets, package limits, shipping increments) and return the combination with the lowest total estimated landed cost, plus neutral cost-ordered alternatives.

### Modified Capabilities
- `landed-cost-calculator`: Adds an offer-constrained calculation entrypoint shared with the optimizer, keeping the public single-item behavior unchanged.
- `transport-estimation`: Adds unified per-shipment selection semantics so a shipment containing a single product line resolves to the same transport offer the single-item calculator selects.
- `product-data-model`: Adds the `merchantTerms` and `basketCalculationRecords` tables.
- `web-application`: Adds the basket builder and optimization results page and the multi-store comparison view, behind a feature flag.

## Impact

- **Code**: New files under `packages/core-domain/src/optimizer/`, `packages/application-api/src/basket/`, `apps/frontend/src/app/basket/`, plus repositories under `packages/data-platform/src/repositories/`. Modifications to `packages/core-domain/src/calculator/`, `packages/core-domain/src/transport/`, `packages/data-platform/src/schema.ts`, `apps/backend/src/` composition root, `packages/application-api/src/feature-flags/`, `apps/frontend/src/lib/`, and `apps/frontend/src/app/compare/`.
- **APIs**: New `POST /api/v1/basket/optimize`. No breaking changes to existing endpoints.
- **Dependencies**: None. Search is exhaustive enumeration; storage uses the existing PostgreSQL + Drizzle stack.
- **Data**: Two new tables. `merchantTerms` is merchant-keyed and small; `basketCalculationRecords` grows with optimizer usage and follows the same retention rules as `calculationRecords`.
- **Infrastructure**: None.
- **Documentation**: `docs/tasks.md` T2.6 through T2.9 updated with completion notes.

## Task mapping

| docs/tasks.md | Change tasks |
|---|---|
| T2.6 basket optimization module | 1.1, 1.3, 2.1, 2.2, 2.4 |
| T2.7 bounded combinatorial search | 2.2 |
| T2.8 engine reuse consistency | 1.3, 2.3, 5.3 |
| T2.9 multi-store comparison + basket UI | 3.2, 4.1, 4.2, 4.3 |

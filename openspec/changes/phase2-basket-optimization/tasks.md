# Phase 2B — Basket Optimization — Tasks

> Derived from Task 2B (T2.6 through T2.9) of `docs/tasks.md`.
> All tasks assigned to `platform-engineer` (TypeScript, NestJS, Drizzle, React scope). No `devops-engineer` tasks: no infrastructure or CI/CD changes.

---

## 1. Data model and calculator foundation

- [x] 1.1 Add `merchantTerms` table to `packages/data-platform/src/schema.ts` — merchantId (unique), minimumOrderValueCents (nullable), currency, sourceUrl, reliabilityStatus, observedAt; Drizzle migration; repository at `packages/data-platform/src/repositories/merchant-terms.repository.ts` (findByMerchant, upsert) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**, packages/data-platform/src/repositories/merchant-terms.repository.ts] -->
- [x] 1.2 Add `basketCalculationRecords` table to `packages/data-platform/src/schema.ts` — sessionId, destination, transport arrangement, input basket JSONB, per-shipment breakdown JSONB, totalCents, confidence, disclaimer, timestamp; Drizzle migration; repository at `packages/data-platform/src/repositories/basket-calculation-record.repository.ts` (create, findById) <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/drizzle/**, packages/data-platform/src/repositories/basket-calculation-record.repository.ts] -->
- [x] 1.3 Extract the shared per-offer item-cost computation from `LandedCostCalculatorService` — offer-constrained internal entrypoint (retail costs, excise, container duty, classification, per-input reliability) invoked by both `calculate()` after `selectBestOffer` and the optimizer; public single-item behavior unchanged; existing calculator unit tests stay green <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/calculator/**] -->

## 2. Basket optimizer module

- [x] 2.1 Create the optimizer module at `packages/core-domain/src/optimizer/` — types (`BasketOptimizationInput`, `BasketShipment`, `BasketOptimizationResult`), `IMerchantTermsPort`, Nest module; zero imports from billing <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/core-domain/src/optimizer/**] -->
- [x] 2.2 Implement candidate resolution and the exhaustive search — candidates from active, classification-passing retail offers per item; enumerate item-to-merchant assignments within caps (max 10 items, max 8 candidates per item); per-store grouping; minimum-order feasibility from merchant terms; deterministic tie-breaking (total, then store count, then lexicographic merchant order); prefetch offers and terms before enumeration, no I/O inside the loop <!-- agent: platform-engineer.build, depends_on: [1.3, 2.1], touches: [packages/core-domain/src/optimizer/**] -->
- [x] 2.3 Unify per-shipment transport selection in the transport module — consolidated multi-item shipments via `BasketShippingCalculator`; a shipment containing a single product line resolves to the same transport offer as `TransportEstimationService.estimate` for matching inputs; existing transport tests stay green <!-- agent: platform-engineer.build, depends_on: [2.2], touches: [packages/core-domain/src/transport/**, packages/core-domain/src/optimizer/**] -->
- [x] 2.4 Assemble the optimizer result — per-shipment itemized breakdowns from the shared item-cost core, confidence aggregation via `ConfidenceFrameworkService` over all inputs (including threshold reliability), structural disclaimer, cost-ordered neutral alternatives (top 3), PERSONAL arrangement restricted to single-store; persist via the basket calculation record port <!-- agent: platform-engineer.build, depends_on: [2.2, 2.3, 1.2], touches: [packages/core-domain/src/optimizer/**] -->

## 3. Composition root and API

- [x] 3.1 Register adapters in the `apps/backend` composition root — merchant-terms port adapter over the repository, optimizer module wiring <!-- agent: platform-engineer.build, depends_on: [2.1, 1.1, 1.2], touches: [apps/backend/src/**] -->
- [ ] 3.2 Create `BasketOptimizerController` + module at `packages/application-api/src/basket/` — `POST /api/v1/basket/optimize`; DTO validation (item cap, quantity bounds, destination format); `RateLimitGuard`; `enable_basket_optimization` gate; version-aware idempotency keyed on the basket input; error mapping (404 unknown product, 422 no covering offers or classification-gated item, 400 over-cap or invalid input); register the basket-record persistence port adapter in the composition root (port defined in 2.4) <!-- agent: platform-engineer.build, depends_on: [2.4, 3.1, 5.1], touches: [packages/application-api/src/basket/**, apps/backend/src/**] -->

## 4. Frontend

- [ ] 4.1 Add basket types and fetch client under `apps/frontend/src/lib/` — mirror the API contract including per-shipment reliability, confidence, and alternatives <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/frontend/src/lib/**] -->
- [ ] 4.2 Create the basket page under `apps/frontend/src/app/basket/` — multi-item builder with quantities (reusing the `ProductSelector` pattern), destination and transport arrangement inputs, recommended combination plus neutral alternatives, per-store cards with per-item breakdowns, freshness badges, structural disclaimer, controlled vocabulary; hidden when the flag is off <!-- agent: platform-engineer.build, depends_on: [4.1], touches: [apps/frontend/src/app/basket/**] -->
- [ ] 4.3 Add the multi-store comparison view to the compare page — store-grouped costs with per-item figures and reliability statuses, objective ordering, behind the same feature flag <!-- agent: platform-engineer.build, depends_on: [4.2], touches: [apps/frontend/src/app/compare/**] -->

## 5. Feature flag and tests

- [x] 5.1 Add the `enable_basket_optimization` feature flag to the existing `FeatureFlagService`/`LaunchGate` infrastructure — default off; gates the API route and the UI <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/application-api/src/feature-flags/**] -->
- [ ] 5.2 Write optimizer unit tests — search correctness (cheapest selection incl. multi-store splits), caps enforcement, minimum-order feasibility (verified blocks, unverified downgrades), deterministic tie-breaking, multi-item weight-bracket handling, billing-type isolation (source-level, per the ranking isolation convention) <!-- agent: platform-engineer.build, depends_on: [2.4], touches: [packages/core-domain/src/optimizer/__tests__/**] -->
- [ ] 5.3 Write the calculator-consistency regression test at `tests/integration/` — single-item single-store optimizer result equals the calculator result for identical inputs and dataset versions, using real engine implementations and no mocks <!-- agent: platform-engineer.build, depends_on: [2.4, 2.3], touches: [tests/integration/**] -->
- [ ] 5.4 Write API integration tests at `tests/integration/` — flag-off 403, validation errors (caps, quantities), idempotent replay, rate limiting on the optimize endpoint <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [tests/integration/**] -->

## 6. Verification

- [ ] 6.1 Run typecheck, lint, unit tests, and golden-dataset regression tests; fix fallout <!-- agent: platform-engineer.fast, depends_on: [4.3, 5.2, 5.3, 5.4], touches: [] -->
- [ ] 6.2 Update `docs/tasks.md` — mark T2.6 through T2.9 with completion notes referencing this change <!-- agent: platform-engineer.fast, depends_on: [6.1], touches: [docs/tasks.md] -->

---

## Summary

| Group | Tasks | Agent |
|-------|-------|-------|
| 1. Data model and calculator foundation | 3 | platform-engineer |
| 2. Basket optimizer module | 4 | platform-engineer |
| 3. Composition root and API | 2 | platform-engineer |
| 4. Frontend | 3 | platform-engineer |
| 5. Feature flag and tests | 4 | platform-engineer |
| 6. Verification | 2 | platform-engineer |
| **Total** | **18** | |

### Wave execution order (dependency-aware)

```
Wave 1 (5 tasks):   1.1, 1.2, 1.3, 2.1, 5.1
Wave 2 (2 tasks):   2.2, 3.1
Wave 3 (1 task):    2.3
Wave 4 (1 task):    2.4
Wave 5 (2 tasks):   3.2, 5.2
Wave 6 (3 tasks):   4.1, 5.3, 5.4
Wave 7 (1 task):    4.2
Wave 8 (1 task):    4.3
Wave 9 (1 task):    6.1
Wave 10 (1 task):   6.2
```

`ob-plan-apply` recomputes exact waves from the annotations; the sketch above is indicative only. Same-file serialization via `touches` (1.1/1.2 share `schema.ts`; 2.2/2.3/2.4 share the optimizer directory) is enforced regardless of `depends_on`.

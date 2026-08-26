## Context

Phase 2B builds basket optimization on a complete Phase 1 stack: NestJS modular monolith (`data-acquisition`, `core-domain`, `data-platform`, `application-api`, Next.js frontend), PostgreSQL with Drizzle, Redis-backed BullMQ jobs. The landed-cost calculator, tax engines, transaction classification, confidence framework, and `BasketShippingCalculator` are complete and tested. Feature-flag, rate-limiting, and version-aware idempotency infrastructure is in place and already used by the calculator API.

Relevant present-state facts that shape this design:

- `LandedCostCalculatorService.calculate` resolves the product, picks the globally lowest retail offer (`selectBestOffer`), then runs transport estimation, tax engines, classification, and confidence. There is no way to compute a landed cost for a chosen merchant.
- `BasketShippingCalculator.calculateBasket` computes a consolidated shipment cost for a set of items (total weight, dominant package tier, bracket matching, threshold checks) but its offer-selection rules differ from `TransportEstimationService.estimate`, which the single-item calculator path uses.
- No minimum-order threshold data exists anywhere in the schema or merchant config.

Architecture rules that constrain this change: neutrality (no commercial signal may affect ordering), every externally sourced fact carries reliability and timestamp, every calculated figure is explainable and traceable to dataset versions, the disclaimer is structural, background work stays off the request path, and new user-facing behavior rolls out behind a feature flag.

## Goals / Non-Goals

**Goals:**
- Evaluate single-store purchase and multi-store splits for a multi-item basket against minimum-order thresholds, weight brackets, package limits, and shipping increments, returning the lowest total estimated landed cost (T2.6).
- Implement the search as a bounded combinatorial enumeration over candidate merchant assignments; exhaustive search across a small merchant set is acceptable (T2.7).
- Reuse the same Tax and Duty and Transport Estimation code paths as the single-item calculator so optimizer and calculator results are never inconsistent for the same inputs (T2.8).
- Build the basket-optimization UI and multi-store comparison view (T2.9).

**Non-Goals:**
- Purchase, checkout, or order management (calculator, not a shop).
- Automated fetching of merchant minimum-order thresholds (manual or seed entry with reliability marking; pipeline automation deferred).
- Basket-level historical analysis (2A scope) and cross-basket analytics.
- Multi-store evaluation for PERSONAL transport arrangement (single-store options only).
- Heuristic or pruned search algorithms; exhaustive enumeration within explicit caps is sufficient for the merchant count in the foreseeable phase.

## Decisions

### Decision 1: Offer-constrained item-cost core inside the calculator, not a parallel orchestrator

**Choice**: Extract the offer-specific steps of `LandedCostCalculatorService` (retail offer costs, excise, container duty, classification, per-input reliability) into a shared internal computation that both `calculate` (after `selectBestOffer`) and the optimizer (per chosen offer) invoke. The public single-item API and behavior stay unchanged.
**Alternatives considered**: Optimizer re-implements orchestration over the engines (risks divergence, violates T2.8); optimizer calls `calculate` per item (cannot: `calculate` picks the lowest offer itself and adds per-item transport).
**Rationale**: T2.8 demands identical figures for identical inputs. A single shared code path plus a consistency regression test is the only structure that guarantees it structurally rather than by discipline.

### Decision 2: Exhaustive enumeration over item-to-merchant assignments with explicit caps

**Choice**: Candidate merchants per item are the merchants with an active retail offer for that item (classification-gated products are excluded as usual). The search enumerates assignments of items to candidate merchants, groups items by store, and evaluates each grouping: per-item costs from the shared core, one consolidated shipment per store, minimum-order feasibility. Caps: maximum 10 distinct items and maximum 8 candidate merchants per item; requests beyond the caps fail validation with 400. Deterministic tie-breaking: lower total first, then fewer stores, then lexicographic merchant order.
**Alternatives considered**: Pruned search (branch-and-bound, DP over subsets; unnecessary complexity at current merchant counts); greedy assignment by lowest unit price (cannot capture shipping non-linearity or thresholds, can miss the optimum).
**Rationale**: The implementation plan explicitly accepts straightforward exhaustive search across a small number of candidate merchants. Explicit caps keep the worst case bounded (8^10 worst case is prevented by the candidate cap and, in practice, by the merchant count; the caps are validated before any computation). Determinism is required for idempotent caching and for neutrality auditability.

### Decision 3: Minimum-order threshold as merchant-level externally sourced data

**Choice**: New `merchantTerms` table: merchantId (unique), minimumOrderValueCents (nullable), currency, sourceUrl, reliabilityStatus, observedAt. A missing row means no known threshold. An assignment whose store subtotal is below a VERIFIED threshold is infeasible for that store. When the threshold data is not VERIFIED, the combination stays eligible but the result confidence is downgraded through the confidence framework.
**Alternatives considered**: Column on `retailOffers` (wrong granularity; threshold is store-level); field on `MerchantConfig` in data-acquisition config (config is ingestion-side, carries no reliability provenance, unreachable from core-domain without a new dependency direction).
**Rationale**: Architecture rule: every externally sourced fact carries a reliability status and timestamp, and unknown inputs are never silently assumed. Store-level terms deserve their own small entity. Treating below-threshold stores as infeasible (when verified) is the honest model: the merchant would not accept the order.

### Decision 4: Per-shipment transport through the transport module, with unified single-line semantics

**Choice**: Each store group ships as one consolidated shipment priced by `BasketShippingCalculator` (weight brackets, dominant package tier, increments). The transport module's selection rules are unified so that a shipment containing a single product line resolves to the same transport offer (and therefore the same cost) that `TransportEstimationService.estimate` returns for the single-item calculator path with matching inputs.
**Alternatives considered**: Keep two selection rules and accept a divergence for single-line shipments (violates T2.8); always use `BasketShippingCalculator` in the calculator too (changes existing single-item behavior, wider blast radius than this change needs).
**Rationale**: T2.8 consistency must hold in both directions: calculator-vs-optimizer for one product. Unifying the selection rule in the transport module (both paths funnelling to the same bracket-matching logic) removes the divergence class instead of patching a symptom. The change is additive to transport-estimation; existing tests stay green.

### Decision 5: `basketCalculationRecords` persistence, mirroring calculation records

**Choice**: Persist every optimizer result: input basket, destination, transport arrangement, per-shipment breakdown (JSONB), total, confidence, structural disclaimer, session ID, timestamp. Served by its own repository behind a core-domain port.
**Alternatives considered**: Reuse `calculationRecords` (schema is single-product: one productMasterId, single offer FK; forcing baskets in would distort the audit model); persist nothing (breaks the correction-mechanism parity and the every-shown-result-is-recorded convention from Phase 1).
**Rationale**: The correction mechanism and audit conventions assume every result shown to a user is recorded and reconstructable. A dedicated table keeps `calculationRecords` honest and the basket audit self-contained. Retention follows the same policy as `calculationRecords`.

### Decision 6: API follows the calculator controller pattern

**Choice**: `POST /api/v1/basket/optimize` in a new `application-api/basket/` module: DTO validation (item count cap, quantity bounds, destination), `RateLimitGuard`, `enable_basket_optimization` flag check, version-aware idempotency keyed on the basket input (extending the existing `IdempotencyService` cache-key shape), error mapping consistent with the calculator (404 unknown product, 422 no covering offers or classification-gated item, 400 over-cap or invalid quantity). The optimizer runs on the request path only for the search itself; no background job is spawned per request.
**Alternatives considered**: Async job + polling (adds job lifecycle complexity for a computation bounded by the caps); no idempotency (wasteful; identical baskets are the common retry case).
**Rationale**: Bounded synchronous execution matches the calculator's latency profile. Reusing the established guard, flag, and idempotency infrastructure keeps the API surface consistent. Per-calculation cost attribution (existing `CostAttributionService`) treats one optimize call as one calculation unit.

### Decision 7: UI as a basket page plus a store-grouped compare view, behind the flag

**Choice**: New `apps/frontend/src/app/basket/` page: basket builder (product search via the existing `ProductSelector` pattern, quantities, destination, transport arrangement), results view with the recommended combination and up to three cost-ordered neutral alternatives, per-store cards carrying per-item breakdowns, reliability and freshness badges, and the structural disclaimer. The compare page gains a store-grouped multi-store comparison view. Both are hidden entirely when `enable_basket_optimization` is off.
**Alternatives considered**: Extend the existing calculator page (single-product state model does not fit a basket); ship ungated (violates the flag rule for new user-facing behavior).
**Rationale**: Controlled vocabulary and visual neutrality rules apply unchanged: no design element may suggest a promoted store, and alternatives differ only in cost and store composition.

## Risks / Trade-offs

- **Search cost grows with merchant count**: worst case is the product of per-item candidate counts. Mitigation: hard caps validated before computation (400 beyond caps); merchant count is small in this phase; the search is pure CPU with no I/O inside the enumeration loop (offer and term data prefetched once).
- **Threshold data freshness**: a stale minimum-order threshold can make a shown combination wrong. Mitigation: threshold rows carry reliability status; non-VERIFIED thresholds downgrade confidence and the UI surfaces the badge; corrections can fix terms like any other data point.
- **Transport unification regression risk**: touching selection rules shared with the calculator path can shift existing single-item results. Mitigation: the existing golden-dataset regression tests and the new calculator-consistency test cover both paths; behavior change is constrained to cases where the two rules previously disagreed for single-line shipments.
- **Optimizer result heavier than a single calculation**: many engine invocations per request. Mitigation: caps bound the work; idempotency cache absorbs repeats; per-calculation cost attribution observes the cost per optimize call.

## Open Questions

1. **Cap values**: 10 items and 8 candidates per item are the proposed defaults. Confirm or adjust after the first staging load measurements.
2. **Entitlement tier**: should basket optimization be available to all users (like the calculator) or gated to PREMIUM? Proposal default: all users behind the feature flag; entitlement wiring is a one-line change if the business decision differs.
3. **Alternatives count**: top 3 alternatives in the response. Confirm against UI density preferences.
4. **Minimum-order threshold sourcing workflow**: initial values enter via seed or manual entry; a later change can add ingestion-side automation (out of scope here).

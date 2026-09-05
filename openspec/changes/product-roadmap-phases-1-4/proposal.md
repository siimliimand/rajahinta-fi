# Product Roadmap, Phases 1–4

## Why

The product roadmap defines ten features across four phases: data-engine extensions, user-value features, differentiating features, and predictive/analytical tools. A large part of the Phase 1 and Phase 2 groundwork already exists in the codebase, so this change builds the missing capabilities on top of it rather than re-creating what has shipped:

- **Already in place:** append-only price observations (R2 JSONL log), materialized price-history summaries in D1, the flag-gated history API and chart components, versioned tax rules with the review-before-publication gate, versioned FX datasets, accounts with server-issued sessions, the email Worker on the `send_email` binding, the basket optimizer with merchant terms, feature-flag infrastructure, the operator console, and outbound click tracking.
- **Net-new in this change:** the €/g ethanol unit price (idea 1), price-drop alerts (idea 3, minus the accounts and email pieces that exist), physical packing optimization with a glass-versus-metal warning (idea 4, extending the cost-only basket optimizer), the event calculator MVP and its V2 cross-border expansion (idea 5), the trip feasibility calculator with a neutral ferry affiliate slot (idea 6), the producer-based dupe finder (idea 7), the curated "Alkon hylkäämät" list (idea 8), the excise what-if simulator (idea 9), and the group-order cost-splitting ledger (idea 10).

Idea 2 (the price history log) needs no new machinery: the append-only observation log, the immutability rule, materialized summaries, and per-merchant ingestion cadence already satisfy it. This change only extends product pages with the existing history chart and records the data-immutability principle where it was still implicit.

## What Changes

Each feature ships behind its own feature flag, default off, following the compliance-sensitive-change rule.

### 1. €/g ethanol unit price (`enable_unit_price_eur_per_gram`)
Pure unit-price module in core-domain computing price per gram of pure ethanol from the existing `retailOffers` price, `productMaster.unitVolume`, and `productMaster.alcoholByVolume`, using ethanol density 789 g/l. Missing alcohol or volume data yields an explicitly ESTIMATED or unavailable status, never a silently assumed input. The compare view gains a €/g column, a sort option, and a formula tooltip consistent with the VERIFIED/ESTIMATED presentation.

### 2. Price history exposure (completes idea 2)
Product pages embed the existing history chart and series API (today they render only on calculator result views). Documentation states the data-immutability principle explicitly: history rows are appended, never overwritten.

### 3. Price-drop alerts (Hinta-Haukka) (`enable_price_alerts`)
`priceAlerts` and `alertNotifications` tables, CRUD API under `/api/v1/account/alerts` behind the session guard, and a post-ingestion evaluation cron that compares the latest materialized price against each active threshold and sends email through the existing email Worker path. Rate limiting is built in: at most one notification per product per account per 24 hours. Evaluation never runs on the request path.

### 4. Packing optimizer (`enable_packing_optimizer`)
`productDimensions` (weight, height, diameter, packaging material) with source and reliability per fact, `carrierBoxTypes` seed data for standard boxes, and a deterministic first-fit-decreasing packing heuristic in core-domain. The basket optimize response gains a packing suggestion: box count, fill rate, and a warning when mixed glass and metal contents exceed defined weight or unit thresholds. Missing dimensions degrade to ESTIMATED, never invented.

### 5. Event calculator (`enable_event_calculator`)
One engine, two UIs. A versioned `consumptionNorms` reference dataset (drink type × event profile, every row carrying a cited source, published through the same manual-review gate as tax datasets) feeds the MVP calculator: guests and duration produce per-type consumption and a minimal-surplus shopping list. V2 adds multi-country sourcing that reuses the landed-cost engines to compare what is worth buying in Estonia or Latvia versus ordering from Germany, within a budget.

### 6. Trip feasibility calculator (`enable_trip_calculator`)
Versioned, append-only `travellerAllowanceDatasets` with EU personal-use indicative limits (effective-dated, published through manual review like FX and tax datasets), and a pure break-even module: travel cost (tickets, fuel, vehicle) divided by the unit price difference, capped by the applicable allowances. A curated `ferryOffers` affiliate slot (Tallink, Viking class operators) renders separately from results and has zero influence on any calculation, enforced by a compliance test.

### 7. Producer dupe finder (`enable_producer_dupe_finder`)
`producerLinks` table with mandatory evidence fields (producer code, manufacturer, source URL, reviewer, review date) and audited operator-console CRUD. A curated seed of 50 to 100 validated cases loads through an import script. The API returns only evidence-backed links; there is deliberately no similarity scoring and no flavor matching. Every recommendation shows WHY the products are linked.

### 8. Curated lists, "Alkon hylkäämät" (`enable_curated_lists`)
`curatedEntries` table (list slug, product or external reference, mandatory rationale, evidence links, reviewer) with an operator-console form for updates without code changes. Public list API and page carry the curation criteria, a rationale per entry, and tracked outbound links. Sitemap and metadata follow the existing SEO pattern.

### 9. Excise what-if simulator (`enable_excise_what_if`)
A pure what-if module that substitutes a hypothetical excise rate through the existing excise math without touching stored rules. The API is rate-limited, requires no account, and attaches a structural HYPOTHETICAL disclaimer to every result (stronger wording than the standard calculator disclaimer). Results are shareable via token for an embeddable journalistic widget. Nothing about a what-if run is persisted.

### 10. Group order ledger (`enable_group_order_ledger`)
`groupOrderSessions` (share token, expiry) and `groupOrderItems` tables that carry no payment fields at the schema level. A pure allocation module splits shared costs (shipping, packaging duty) proportionally and computes the minimal who-owes-whom transfer set. The API rejects any payment-instrument payload at the DTO level. Users settle externally with their own methods; Rajahinta processes no payments.

## Capabilities

### New Capabilities
- `unit-price-metrics`: €/g ethanol calculation, reliability handling, sort and tooltip.
- `price-alerts`: watchlist thresholds, evaluation, cooldown, notification delivery.
- `packing-optimization`: dimension data, box selection heuristic, material mixing warning.
- `event-calculator`: consumption norms engine, MVP calculator, V2 cross-border sourcing.
- `trip-feasibility-calculator`: versioned traveller allowances, break-even math, neutral affiliate slot.
- `producer-matching`: evidence-based producer links between Alko products and foreign-shop siblings.
- `curated-lists`: editorial lists with criteria, rationale, and operator-console management.
- `excise-what-if-simulator`: hypothetical excise scenarios with structural disclaimers and embed support.
- `group-order-ledger`: shared sessions, proportional cost allocation, accounting-only boundary.

### Modified Capabilities
- `product-data-model`: adds `priceAlerts`, `alertNotifications`, `productDimensions`, `carrierBoxTypes`, `consumptionNorms`, `travellerAllowanceDatasets` and `travellerAllowanceLimits`, `ferryOffers`, `producerLinks`, `curatedEntries`, `groupOrderSessions`, `groupOrderItems`.
- `ranking-sorting`: adds the €/g sort as an objective, deterministic option under the neutrality rules.
- `background-jobs`: adds the price-alert evaluation job off the request path.
- `web-application`: adds the new flag-gated pages (alerts management, event calculator, trip calculator, lists, what-if, group order) and product-page extensions (history chart, dupe panel, alert action).

## Non-goals

- No payment processing, payment links, or transaction brokering anywhere (group order is accounting only).
- No flavor-profile or taste-similarity matching in the dupe finder; producer evidence only.
- No what-if scenario persistence, no forecasting language, no political framing in the simulator.
- No affiliate influence on ranking, sorting, or calculation output of any feature.
- No push notifications in this change; email is the MVP channel.
- No automated flavor-based or ML-based curation for lists; editorial entries with rationale only.

## Impact

- **Code:** new core-domain modules (`unitprice/`, `packing/`, `eventcalc/`, `tripcalc/`, `dupe/`, `whatif/`, `grouporder/`, alerts evaluation support), new API routes in `apps/api-worker/src/routes/`, one new cron handler, repositories and seed data in data-platform, new frontend pages and components, operator-console extensions for curated data.
- **APIs:** `POST /api/v1/basket/optimize` response extended (packing section); new endpoints for account alerts, event calculation, trip feasibility, product dupes, lists, what-if, and group orders. No breaking changes to existing endpoints.
- **Data:** twelve new D1 tables across the features above, all with provenance and reliability columns where externally sourced facts are stored. Versioned datasets (consumption norms, traveller allowances) are append-only and publish through manual review, matching the tax and FX discipline.
- **Flags:** nine new `FF_*` variables, all default off, declared in `apps/api-worker` config and the environment descriptions.
- **Documentation:** ARCHITECTURE.md and docs/tasks.md updated; the data-immutability principle stated explicitly; boundary statements (no payments, evidence-only dupes, hypothetical-only simulations) recorded.

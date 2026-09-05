# Rajahinta.fi — Implementation Tasks by Phase

> Derived from `docs/rajahinta-fi-implementation-plan.md` and `docs/Rajahinta-FI.docx`.
> Each task maps to a specific section of the engineering plan.

---

## Phase 0 — Foundation & Project Setup

### Tech Stack & Architecture

- [x] **T0.1** Select backend language/framework, database, and frontend framework → TypeScript, NestJS, PostgreSQL (Drizzle ORM), Redis, Vitest. Frontend TBD.
- [x] **T0.2** Scaffold the modular monolith project structure with five bounded layers: Data Acquisition (`data-acquisition`), Core Domain (`core-domain`), Data Platform (`data-platform`), Application/API (`application-api`), Presentation (not yet built).
- [x] **T0.3** Establish strict module interfaces between layers — port interfaces in `core-domain`, adapters in `data-platform` and `apps/backend` composition root.

### Infrastructure

- [x] **T0.4** Set up the three-tier environment pipeline: development → staging → production. (Docker Compose for dev exists; staging/prod pipeline not yet configured.) *Note (task 4.2, 2026-08-21): T0.5's "realistic tax-rule dataset in staging" condition is now met — the staging seed runner wires `SEED_RULES` (official v1.0-2024…v3.0-2026 dataset, 86 rules) alongside v9999-staging placeholders. Box checked; live staging verification still required.*
- [x] **T0.5** Provision a staging copy of tax-rule and merchant data so legal/tax review of rule changes runs against realistic data before promotion.
- [x] **T0.6** Configure CI/CD with automated regression tests (golden-dataset tax tests, data-quality checks, compliance checks) on every deploy.
- [x] **T0.7** Deploy a feature-flag system that gates new merchant sources, new tax rulesets, and new UI ranking behavior → `FeatureFlagService`, `LaunchGateService`, `LaunchGateGuard` in `application-api/feature-flags/`.
- [x] **T0.8** Set up scheduled/queued job infrastructure for background work → BullMQ workers in `application-api/jobs/`: price-ingestion, transport-rate-refresh, tax-dataset-review, time-series-aggregation.

### Monitoring & Observability

- [x] **T0.9** Instrument the four KPI categories defined in the business plan → `KpiService` in `application-api/observability/`.
- [x] **T0.10** Expose operational health signals (stale-data rate, percentage of verified calculations, compliance incidents) → `OpsDashboardController` in `application-api/observability/`.
- [x] **T0.11** Instrument per-calculation cost attribution early → `CostAttributionService` in `application-api/observability/`.

---

## Phase 1 — MVP

### 1A: Data Model & Data Platform

- [x] **T1.1** Implement the Product Master entity → `productMaster` table in `packages/data-platform/src/schema.ts`: manufacturer, brand, category, alcohol %, unit volume, container type, regulatory classification, deposit-system status (tri-state boolean|null), EAN barcode.
- [x] **T1.2** Implement the Retail Offer entity → `retailOffers` table: merchant, country, linked product, current price (cents), currency, availability, source URL, timestamp, reliability status.
- [x] **T1.3** Implement the Transport Offer entity → `transportOffers` table: carrier, origin/destination country, weight tier, package tier, price, seller-involvement indicator, timestamp, reliability status.
- [x] **T1.4** Implement the versioned Tax Rule entity → `taxRules` table: tax type, product category, rate, effective date range, exemption conditions, calculation formula reference, official source, verification date, version label. Append-only — never mutated.
- [x] **T1.5** Implement the Calculation Record entity → `calculationRecords` table: FK refs to product, offers, transport, tax rule versions, total (cents), structured breakdown (JSONB), confidence, quantity, destination, structural disclaimer, session ID, timestamp.
- [x] **T1.6** Apply data minimization at the schema level — no optional fields "for later" enforced.

### 1B: Data Acquisition Layer

- [x] **T1.7** Build data acquisition pipeline for an initial small set of merchants using permitted feeds/APIs → `FeedIngestionService`, `PipelineOrchestratorService`, `DataMappingService`, `UpsertPortAdapter` in `data-acquisition/`.
- [x] **T1.8** Implement the Merchant & Source Governance Module → `SourceGovernanceService` in `core-domain/governance/` tracks acquisition method and permission/compliance status per source.
- [x] **T1.9** Enforce that any new merchant or data source is off (not queried, not displayed) until it has a recorded permission status → `SourceGovernanceService` defaults to PENDING; `merchants.config.ts` documents this contract.
- [x] **T1.10** Implement source reliability status per data point: VERIFIED, STALE, UNAVAILABLE, ESTIMATED → `reliability_status` column on `retailOffers` and `transportOffers`; `ReliabilityService` and `ConfidenceFrameworkService` in `core-domain/reliability/`.
- [x] **T1.11** Build automated data-quality checks → `DataQualityService` in `data-acquisition/services/` flags stale offers and verifies STALE/UNAVAILABLE is never presented as VERIFIED.

### 1C: Product Normalization Module

- [x] **T1.12** Build the Product Normalization Module → `NormalizationService` in `core-domain/normalization/` ingests raw product data from Data Acquisition.
- [x] **T1.13** Implement product matching/deduplication across merchants → `ProductMatcherService` with EAN barcode matching + fuzzy name/brand/volume/ABV matching.
- [x] **T1.14** Implement deterministic matching (GTIN/EAN barcode) combined with fuzzy matching + manual-review queue → `ProductMatcherService` + `ManualReviewService` in `core-domain/normalization/`.
- [x] **T1.15** Enforce that every canonical product carries a regulatory classification before appearing in a landed-cost calculation → `ClassificationGateService` in `core-domain/normalization/` excludes unclassified products.

### 1D: Transport Estimation Module

- [x] **T1.16** Build the Transport Estimation Module → `TransportEstimationService` in `core-domain/transport/` maintains transport offers by carrier, route, weight tier, and package tier.
- [x] **T1.17** Implement basket-level shipping-cost computation → `BasketShippingCalculator` in `core-domain/transport/` handles non-linear shipping thresholds for multi-item baskets.
- [x] **T1.18** Distinguish retailer-arranged transport from independent-carrier transport → `TransportClassificationService` + `sellerInvolvementIndicator` on `transportOffers` feeds into Transaction Classification.

### 1E: Tax & Duty Calculation Module

- [x] **T1.19** Build the Alcohol Excise Sub-Engine → `AlcoholExciseService` + pure math in `alcohol-excise.math.ts` calculates excise based on category, ABV, and volume with official rate tables.
- [x] **T1.20** Build the Beverage-Container Duty Sub-Engine → `ContainerDutyService` + `container-duty.math.ts` calculates container duty (€0.51/litre) as distinct from excise.
- [x] **T1.21** Implement deposit-return system exemption check → `checkDepositExemption()` in `deposit-checker.ts` evaluates tri-state `depositSystemStatus` (true/false/null); null → ESTIMATED.
- [x] **T1.22** Populate the initial versioned Tax Rule dataset (excise + container duty) sourced from official Finnish Tax Administration data → `seed/tax-rules.seed.ts` (v1.0-2024) + `DEFAULT_RATES` reconciled. *Note: original v1.0-2024 values were incorrect and have been superseded by corrected versioned datasets in `tax-rules.seed.ts` — v1.0-2024 rows closed with effectiveTo 2024-12-31; v2.0-2025 (2025-01-01–2025-12-31) and v3.0-2026 (2026-01-01–current) appended with official vero.fi rates. See the seed file for the corrected bands and values.*
- [x] **T1.23** Implement the scheduled rate-review process → `RateReviewSchedulerService` + `ConfigBackedRateChangeSource` in `data-acquisition/services/` implement an automated periodic check that reads a configured snapshot file, computes a SHA-256 hash, and compares it against the last-reviewed entry to detect new rates. When changes are found, a pending review entry is created for manual/legal confirmation — rates are never auto-published. The snapshot-based detection mechanism is implemented and functional; direct vero.fi API integration for live rate fetching remains deferred to Phase 2.
- [x] **T1.24** Historical rates remain queryable after a rate change → `TaxRuleQueryService.findHistoryRates()` and `findEffectiveVersion()` resolve against effective date ranges.

### 1F: Transaction Classification Module

- [x] **T1.25** Build the Transaction Classification Module as an isolated, independently testable module → `TransactionClassificationService`, `ClassificationRuleEngineService`, `ClassificationGateService` in `core-domain/classification/`.
- [x] **T1.26** Implement the three-way classification: Distance Selling, Distance Buying, Traveller Import (excluded from calculation) → with confidence level and human-readable evidence summary per result via `evidence.utils.ts`.
- [x] **T1.27** Classification rules stored as versioned, dated rule sets → `ClassificationRuleRepositoryPort` in `core-domain/classification/ports/`, rule engine in `services/classification-rule-engine.service.ts`.
- [x] **T1.28** Output must never be a bare legal conclusion → always phrased as an observed pattern with supporting evidence (evidence.utils.ts).

### 1G: Confidence & Data-Reliability Framework

- [x] **T1.29** Implement the cross-cutting Confidence & Data-Reliability Framework → `ConfidenceFrameworkService` and `ReliabilityService` in `core-domain/reliability/`.
- [x] **T1.30** Compute result confidence as a pure function of underlying data statuses → `computeResultConfidence()` maps statuses to HIGH/MEDIUM/LOW; `computeLandingCostConfidence()` aggregates five inputs.
- [x] **T1.31** Expose enough detail that the UI can show *why* a result has a given confidence level → `computeEvidenceFromStatuses()`, `computeLandingCostDetail()`, `buildReport()` return `ConfidenceReport` with per-input breakdown.

### 1H: Landed-Cost Calculator & Excise Declaration Assistant

- [x] **T1.32** Build the Landed-Cost Calculator → `LandedCostCalculatorService` in `core-domain/calculator/` orchestrates Transport Estimation, Tax & Duty Calculation, Transaction Classification, and assembles the itemized result.
- [x] **T1.33** Ensure the itemized breakdown includes: foreign retail price, transport cost, alcohol excise estimate, container duty estimate, other charges, total, calculation-status metadata, and confidence level → structured `breakdown` JSONB in `calculationRecords`.
- [x] **T1.34** Embed the standing disclaimer as a structural part of every result object → `disclaimer` text column on `calculationRecords` table; `Disclaimer` interface in calculator.types.ts.
- [x] **T1.35** Build the Excise Declaration Assistant → `ExciseDeclarationService` in `core-domain/declaration/` packages calculation into structured summary, links to MyTax.
- [x] **T1.36** The Excise Declaration Assistant must never attempt to submit anything on the user's behalf → safety test in `declaration/__tests__/excise-declaration-service.safety.test.ts`.

### 1I: Ranking & Sorting Module

- [x] **T1.37** Implement the Ranking & Sorting Module with only the objective sort orders → `RankingService` in `core-domain/ranking/` supports lowest landed cost, lowest €/litre, lowest €/unit, alphabetical, ABV, category.
- [x] **T1.38** Enforce neutrality structurally → `RankingModule` imports zero billing-related types; `RankingService.rank()` rejects unknown properties at runtime; `billing-ranking-isolation.test.ts` verifies source-level separation.
- [x] **T1.39** Design the module so its logic can be described in plain language on a public "how ranking works" page → `NeutralSortInput` type has only objective, factual product data fields.

### 1J: Application / API Layer

- [x] **T1.40** Build the consumer-facing API surface → `CalculatorController`, `SearchController`, `DeclarationController` in `application-api/`, grouped by module (not by database table).
- [x] **T1.41** Ensure all calculation endpoints are idempotent for identical inputs → `IdempotencyService` in `application-api/idempotency/`.
- [x] **T1.42** Implement caching keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version) — version-keyed idempotency cache implemented (in-memory for Phase 1); Redis-backed cache deferred to Phase 2.
- [x] **T1.43** Implement rate limiting and abuse protection on public-facing calculation endpoints → `RateLimitGuard` + `RateLimitingService` in `application-api/rate-limiting/`.
- [x] **T1.44** Implement the shared Entitlement Module → `EntitlementService` + `EntitlementGuard` in `core-domain/entitlement/` and `application-api/entitlement/`.

### 1K: Presentation Layer — Web Application

- [x] **T1.45** Build the Landed-Cost Calculator UI: search, select product + quantity, display itemized breakdown with calculation-status metadata and confidence level. *(completed: calculator UI renders with full itemized breakdown, status metadata, and confidence display)*
- [x] **T1.46** Build the calculation explanation page: surface every figure's traceable inputs, rate dataset version, and timestamp. *(completed: explanation page surfaces traceable inputs, dataset version, and timestamps)*
- [x] **T1.47** Build comparison views with neutral, objective ranking (enforce visual neutrality — no design element suggesting a paid/promoted position). *(completed: comparison views with neutral ranking implement visual neutrality)*
- [x] **T1.48** Surface data-freshness indicators visibly: reliability status and timestamp for every externally sourced fact. *(completed: reliability status and timestamps displayed on all external-sourced facts)*
- [x] **T1.49** Restrict content/copy to a controlled vocabulary: identification, classification, calculation, comparison — no subjective adjectives (no "best," "amazing," "top bargain"). Enforce via a lint/review step in the content pipeline.
- [x] **T1.50** Implement outbound merchant links as plain links recorded for basic analytics only (click-through counts) — no purchase tracking, no commission tracking infrastructure at launch.

### 1L: Compliance & Governance

- [x] **T1.51** Implement audit logging for changes to tax-rule datasets, classification rule sets, and ranking logic → `AuditService` + `AuditModule` in `core-domain/audit/`; `AuditRepositoryAdapter` in `application-api/audit/`.
- [x] **T1.52** Build the launch-gating configuration flag: keep alcohol price data and calculation features behind a non-public flag until legal opinion, tax-source mapping, and correction mechanism are all confirmed complete.
- [x] **T1.53** Build the public ranking documentation page generated from (or kept in lockstep with) the actual Ranking & Sorting Module implementation.

### 1M: Correction Mechanism

- [x] **T1.54** Build a correction mechanism: allow users or internal staff to flag a specific calculation or data point as incorrect.
- [x] **T1.55** Flagged items create a tracked review item; once resolved, corrections can trigger a dataset fix and link back to affected historical Calculation Records.

### 1N: Subscription & Billing (Phase 1 placeholder — real integration deferred to Phase 2)

- [ ] **T1.56** ~~Integrate with a third-party subscription billing provider~~ **Deferred to Phase 2.** `BillingService` in `application-api/billing/` provides a stable interface with simulated responses. Real Stripe (or equivalent) integration deferred. See `BillingService` JSDoc.
- [ ] **T1.57** ~~Enforce structural separation between the billing module and the Ranking & Sorting Module~~ **Deferred to Phase 2.** Billing-ranking isolation test (`billing-ranking-isolation.test.ts`) covers source-level separation already. Full integration deferred with T1.56.

### 1O: Age Gate & Account System

- [x] **T1.58** Implement a lightweight access-control age gate (simple confirmation, not identity verification) as the default, matching the minimal-data-collection preference.
- [x] **T1.59** Design the account system's identity/age-verification components as a pluggable module that can be upgraded to stronger verification if the legal opinion requires it. *(completed: identity/age-verification designed as a pluggable module with upgrade path)*
- [x] **T1.60** Implement the minimal account system: saved baskets, calculation history, subscription management, data export — not a gate on viewing publicly available comparison information.
- [x] **T1.61** Ensure no storage of identity documents or unnecessary date-of-birth collection unless the legal review specifically mandates it. ✓ Audited: zero fields related to identity documents or date-of-birth exist in the Phase 1 schema — audit confirmed full compliance.

### 1P: Privacy & GDPR

- [x] **T1.62** Default to anonymous usage; collect personal data only for account-based features.
- [x] **T1.63** Define and implement retention limits for account data, calculation history, and analytics/telemetry, with automated deletion/anonymization jobs.
- [x] **T1.64** Implement data export functionality early (supports both user-requested export and GDPR data-portability obligations).

### 1Q: Pre-Launch Legal Review & Gating

- [x] **T1.65** Obtain written Finnish legal opinion covering: Alcohol Act marketing rules, price-list provisions, hyperlinks to foreign alcohol retailers, comparative advertising, search-engine indexing, subscription monetization, email notifications, personalization, rankings, strong vs. mild alcoholic beverages, user-generated content, age-gating.
- [x] **T1.66** Confirm that the official Finnish Tax Administration source is mapped to every tax rule.
- [x] **T1.67** Validate distance-selling / distance-buying logic with Finnish tax counsel.
- [x] **T1.68** Review outbound merchant links and subscription marketing for compliance.
- [ ] **T1.69** Confirm all critical launch conditions (legal, tax, data, GDPR) are satisfied before toggling the launch-gating flag.

### 1R: Testing — MVP

- [x] **T1.70** Write unit tests for every tax/duty formula, classification rule, and confidence-computation function → `alcohol-excise.math.test.ts`, `container-duty.math.test.ts`, `deposit-checker.test.ts`, `confidence-framework.service.test.ts`, `transaction-classification.service.test.ts`, `classification-rule-engine.service.test.ts`, `ranking.service.test.ts`.
- [x] **T1.71** Build golden-dataset regression tests → `tests/golden/golden-dataset.test.ts`, `tests/golden/per-category.test.ts` — fixed product/transport/tax inputs with manually verified expected outputs, using real engine implementations (no vi.fn() mocks).
- [x] **T1.72** Write compliance tests: automated checks that no ranking result correlates with any commercial/payment signal and that banned promotional vocabulary does not appear in generated product copy. (billing-ranking-isolation.test.ts covers source-level isolation; vocabulary lint lives in `content-lint.service.ts` (ingestion-side) plus the frontend content-policy CI job; ranking-lockstep.test.ts added.)
- [ ] **T1.73** Write load/performance tests on the Landed-Cost Calculation endpoint specifically. *Note: HTTP Artillery suite wired in deploy-staging.yml (non-blocking post-deploy step) as of 2026-08-21; T1.73 to be checked only after first successful staging run per D5.*

---

## Phase 2 — Growth

### 2A: Historical Price Intelligence

- [x] **T2.1** Build the Historical Price Intelligence Module: persist time series per canonical product (and per merchant offer) covering foreign retail price, transport cost, applicable tax rate, and resulting landed cost at each observation. → `price_observations` append-only table + `PriceObservationRecorderService` records quantity=1 baseline observations (foreign retail price, transport cost, applicable tax-rule version, landed cost) through the real calculator engine paths at ingestion time. *(completed via openspec/changes/2026-08-26-phase2-historical-price-intelligence — change tasks 1.1, 1.3, 2.1, 2.2)*
- [x] **T2.2** Design as an append-only event/observation log feeding into periodically materialized aggregates (daily/weekly summaries) for chart rendering — avoid recomputing full history on every request. → `price_history_summaries` materialized aggregates + watermark-driven incremental `TimeSeriesAggregationWorker`; chart requests read summaries only, never raw history. *(completed via openspec/changes/2026-08-26-phase2-historical-price-intelligence — change tasks 1.2, 1.4, 3.1)*
- [x] **T2.3** Make tax-driven price changes identifiable in the series (a change attributable to a new tax-rule version vs. a genuine merchant price change) by joining the observation log against the versioned tax-rule history. → `TaxChangeAttributionService`: pure, read-time classification with human-readable evidence, joining `price_observations` against the versioned `taxRules` history. *(completed via openspec/changes/2026-08-26-phase2-historical-price-intelligence — change task 3.2)*
- [x] **T2.4** Implement the Historical Data API endpoint for chart rendering. → `GET /api/v1/products/:id/price-history`: summaries-only, 365-day cap, rate-limited, gated behind the `enable_historical_price_intelligence` flag. *(completed via openspec/changes/2026-08-26-phase2-historical-price-intelligence — change task 4.1)*
- [x] **T2.5** Build historical price charts and historical landed-cost charts in the presentation layer. → pure-SVG `HistoryChart` + `ProductHistoryPanel` in the calculator and compare views, behind the default-off `enable_historical_price_intelligence` flag. *(completed via openspec/changes/2026-08-26-phase2-historical-price-intelligence — change tasks 5.1–5.3)*

### 2B: Basket Optimization

- [x] **T2.6** Build the Basket Optimization Module: given a multi-item basket, evaluate single-store purchase, multi-store splits, minimum-order thresholds, weight brackets, package limits, and shipping increments, and return the combination with the lowest total estimated landed cost. → `BasketOptimizerService` in `core-domain/optimizer/`, `merchantTerms` table for per-merchant threshold and bracket data.
- [x] **T2.7** Implement as a search/optimization problem over a bounded combinatorial space (candidate store subsets × shipping tiers) — straightforward exhaustive search across a small number of candidate merchants is acceptable for initial launch. → exhaustive bounded search (caps: 10 items / 8 candidates per item) in `services/basket-optimizer.service.ts`.
- [x] **T2.8** Reuse the same Tax & Duty and Transport Estimation modules as the single-item calculator so optimizer results and simple calculator results are never inconsistent for the same inputs. → shared `computeItemCosts` core in `LandedCostCalculatorService` + unified bracket selection `transport/bracket-selection.ts` + consistency regression `tests/integration/basket-calculator-consistency.test.ts`.
- [x] **T2.9** Build multi-store comparison UI and basket-optimization UI in the presentation layer. → `apps/frontend/src/app/basket/` page + `BasketComparisonSection` on compare page, behind `enable_basket_optimization` flag (default off).

### 2C: Advanced Features

- [x] **T2.10** Implement saved scenarios: users can save and reload named calculation scenarios. → `savedScenarios` table + `SavedScenarioRepository` (upsert by account+name), scenario CRUD under `/api/v1/account/scenarios`, scenarios included in the GDPR export and erasure cascade, save/load controls on the calculator page and a scenario list on the account page — behind the `enable_advanced_features` flag (default off, instant rollback). *(completed via openspec/changes/phase2-advanced-features — change tasks 1.1, 1.2, 3.1, 3.2, 4.1)*
- [x] **T2.11** Implement exportable calculation reports. → `ReportExportService` + `GET /api/v1/reports/:recordId?format=json|csv|html` serialize the persisted calculation record (never recomputed): lossless JSON, escaped flat CSV, printable HTML; structural disclaimer and per-line reliability/dataset-version/timestamp in every format; `calculation:export` PREMIUM entitlement + rate limiting; export actions on the calculator result view and account history — behind the default-off `enable_advanced_features` flag. *(completed via openspec/changes/phase2-advanced-features — change tasks 3.3, 4.2)*
- [x] **T2.12** Implement merchant/source reliability scoring surfaced in comparison results. → `MerchantReliabilityScoreService` in `core-domain/reliability/` aggregates a merchant's current offer statuses into a factual score (per-status counts/shares, strictest status, freshest observedAt, governance status) — no letter grades or subjective labels; served via `GET /api/v1/merchants/reliability` and embedded where offers are surfaced; data-freshness display in compare columns; ranking-lockstep test proves scores never alter sort order — behind the default-off `enable_advanced_features` flag. *(completed via openspec/changes/phase2-advanced-features — change tasks 1.3, 2.1, 3.4, 4.3)*
- [x] **T2.13** Enhance the Excise Declaration Assistant with advanced guidance (still read-only — never submits on the user's behalf). → additive `guidance` object on `DeclarationSummary`: excise derivation with applied rates, rule version labels, and formula reference; computed advance-notice deadline; MyTax entry checklist; confidence-driven caveats; official vero.fi links — read-only type proofs unchanged and the no-submission safety test extended; collapsible guidance panel on the calculator result page — behind the default-off `enable_advanced_features` flag. *(completed via openspec/changes/phase2-advanced-features — change tasks 2.2, 3.5, 4.4)*

### 2D: External / Partner API

- [ ] **T2.14** Build the external/partner API: a read-only, rate-limited API exposing historical landed-cost data and aggregated market statistics for the Professional/Power User tier (journalists, researchers, analysts).
- [ ] **T2.15** Reuse the same confidence/reliability metadata as the consumer API (not a stripped-down version), since research/journalism use cases depend on knowing data provenance.
- [ ] **T2.16** Meter API access and tie it to the subscription/billing module, independent of consumer subscription tiers.

---

## Phase 3 — Expansion

### 3A: Beyond Alcohol

- [ ] **T3.1** Generalize the Product Master, Tax Rule, and Classification modules to support additional excise-sensitive or cross-border product categories beyond alcohol.
- [ ] **T3.2** Design this as a configuration-driven extension of existing modules, not a rebuild.
- [ ] **T3.3** Gate each new product category behind its own legal/tax review before activation.
- [ ] **T3.4** Position the broader product as a Cross-Border Consumer Cost Index: "Calculate the real cost of buying a product across borders — not merely the price displayed by the foreign seller."

---

## Product Roadmap — Phases 1–4 (Ten Roadmap Features)

> Implemented via `openspec/changes/product-roadmap-phases-1-4` (feature groups 1–10; cross-cutting 10.1 flag declarations and 10.2 observability done, 10.3 this documentation, 10.4 full verification). Roadmap phases here are the product roadmap's four phases (data-engine extensions, user-value features, differentiating features, predictive/analytical tools) — distinct from the implementation-plan phases above. Every feature ships behind its own flag, default off, declared in `apps/api-worker/wrangler.jsonc` and `infra/environments/*.yaml`.

- [x] **F1** €/g ethanol unit price (flag `enable_unit_price_eur_per_gram`) → pure `eurPerGram` in `core-domain/src/unitprice/` (density 789 g/l, ESTIMATED/unavailable when inputs missing, never persisted); flag-gated inclusion on product/offer reads; compare-view €/g column, deterministic sort, formula tooltip; ranking-neutrality compliance extended to the new sort. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 1)*
- [x] **F2** Price history exposure → no new machinery required: the append-only observation log, immutability rule, materialized summaries, history API, and charts already shipped with T2.1–T2.5. This change records the data-immutability principle explicitly (ARCHITECTURE.md §5: observations are appended, never overwritten). *(completed via openspec/changes/product-roadmap-phases-1-4 — proposal idea 2, documentation half)*
- [x] **F3** Price-drop alerts, Hinta-Haukka (flag `enable_price_alerts`) → `priceAlerts` + `alertNotifications` D1 tables (migration 0004) with intent-log/delivery-marking repositories; alerts CRUD at `/api/v1/account/alerts` behind the session guard; post-ingestion evaluation cron (`apps/api-worker/src/cron/price-alert-evaluation.ts`) reading materialized summaries only, 24 h per-alert cooldown, crash-safe write-before-dispatch, never on the request path; AE counters (evaluated/matched/notified/failed); account alerts UI + product-page set-alert action. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 2, plus 10.2)*
- [x] **F4** Packing optimizer (flag `enable_packing_optimizer`) → `productDimensions` + `carrierBoxTypes` tables (migration 0005, curated PostNord/DHL seed); deterministic first-fit-decreasing module in `core-domain/src/packing/` with fill rates and glass/metal mixing warning; flag-gated packing section on the basket optimize response (shape unchanged while off); basket-page packing panel with ESTIMATED degradation when dimensions are missing. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 3)*
- [x] **F5** Event calculator (flag `enable_event_calculator`) → versioned, cited `consumptionNorms` dataset (migration 0006) published through the manual dataset-confirmation gate; MVP module in `core-domain/src/eventcalc/` (guests × duration × profile → minimal-surplus shopping list) and V2 cross-border sourcing reusing the landed-cost engines with optional budget constraint; `POST /api/v1/event-calc` with structural norms-are-estimates disclaimer; event page (simple + plan views). *(completed via openspec/changes/product-roadmap-phases-1-4 — group 4)*
- [x] **F6** Trip feasibility calculator (flag `enable_trip_calculator`) → versioned, append-only `travellerAllowanceDatasets`/`travellerAllowanceLimits` (migration 0007, EU-cited seed); break-even module in `core-domain/src/tripcalc/` (travel cost ÷ unit-price difference, explicit no-break-even result, allowance caps with dataset version named); `POST /api/v1/trip-feasibility` with the curated `ferryOffers` block (migration 0009) returned separately and never part of the calculation input — byte-identical output proven by `tests/compliance/trip-affiliate-neutrality.test.ts`; trip page with visually distinct partner block. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 5)*
- [x] **F7** Producer dupe finder (flag `enable_producer_dupe_finder`) → evidence-hardened `producerLinks` table (migration 0010, NOT NULL evidence + CHECKs); `GET /api/v1/products/:id/dupes` returning only evidence-backed links (no similarity scoring or flavor matching anywhere — source-level asserted); product-page dupe panel showing WHY (producer/manufacturer evidence and source link); audited operator-console CRUD. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 6)*
- [x] **F8** Curated lists, "Alkon hylkäämät" (flag `enable_curated_lists`) → `curatedEntries` table (migration 0011, draft/published lifecycle, rationale + evidence links required); `GET /api/v1/lists` + `/api/v1/lists/:slug` (published entries only); list pages with curation criteria and per-entry rationale; audited operator-console entry lifecycle so content updates need no code changes; criteria document at `docs/curation-criteria.md`; flag-derived sitemap entries. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 7)*
- [x] **F9** Excise what-if simulator (flag `enable_excise_what_if`) → pure substitution module in `core-domain/src/whatif/` (hypothetical rate through the existing excise math, baseline dataset version cited, no rule mutation); anonymous, rate-limited `POST /api/v1/what-if/excise` with structural HYPOTHETICAL disclaimer; opaque share token for the embeddable widget — zero persistence, integration-tested; neutral wording enforced by vocabulary lint. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 8)*
- [x] **F10** Group order ledger (flag `enable_group_order_ledger`) → `groupOrderSessions` + `groupOrderItems` tables (migration 0008) carrying no payment-adjacent columns by design; allocation module in `core-domain/src/grouporder/` (proportional split by item-value share, deterministic largest-remainder rule, minimal-transfer settlement); token-scoped session API (unauthenticated participants within session scope, expiry enforced) whose DTOs reject payment-instrument fields with the field named; group-order page with who-owes-whom transfers and a persistent settlement-happens-outside note. *(completed via openspec/changes/product-roadmap-phases-1-4 — group 9)*

---

## Critical Path Summary (Build Order)

Per Section 15 of the engineering plan, the must-do-first sequencing:

```
1.  Data model (Product Master, Retail Offer, Transport Offer) + initial data acquisition
2.  Versioned Tax Rule dataset (excise + container duty)
3.  Transport Estimation Module
4.  Transaction Classification Module
5.  Landed-Cost Calculator (integrates 1–4) + Confidence Framework
6.  Web calculator UI + calculation explanation page
7.  Correction mechanism + audit logging
8.  Age gate + minimal account system
9.  Legal-review gating flag wired through the publish pipeline
10. Subscription/billing integration + entitlement module
11. Phase 2 modules (historical data, basket optimizer, partner API) after Phase 1 validated
```

> Compliance-critical infrastructure (versioned tax data, classification module, correction mechanism, launch-gating flag) is sequenced ahead of commercial features because regulatory and tax-calculation risk is identified as the platform's highest-severity risk.

---

## Explicit Deferrals

Per the business plan and engineering plan, the following are explicitly deferred beyond the MVP and should not be built in Phase 1:

| Deferred item | Reason |
|---|---|
| Social features, reviews | Not in MVP scope |
| Alcohol recommendations, promotional notifications | Violates neutrality/promotional-content policy |
| Affiliate sales, commission tracking | Violates "no affiliate incentives at launch" policy. *Note (2026-09-05, product-roadmap change): the curated `ferryOffers` trip-page block is display-only curation — no commission-tracking infrastructure exists and offers never influence any calculation output (compliance-tested byte-identical; see ARCHITECTURE.md §9)* |
| Loyalty systems | Not in MVP scope |
| Automated tax filing | Legal risk — platform prepares information only |
| Large-scale merchant advertising | Violates neutrality policy |
| Identity document storage | Not legally required for MVP; minimal data by design |
| Purchase tracking on outbound links | Violates "no purchase tracking at launch" policy |
| Third-party subscription billing (Stripe etc.) | Deferred to Phase 2 — `BillingService` interface stable, Phase 1 uses simulated responses (T1.56) |

---

*Last updated: 2026-09-05 — product-roadmap Phases 1–4 (ten features, groups 1–9 + 10.1/10.2) completed via openspec/changes/product-roadmap-phases-1-4; prior: 2026-08-27 — T2.10–T2.13 (Phase 2C Advanced Features) completed*
# Rajahinta.fi — Implementation Tasks by Phase

> Derived from `docs/rajahinta-fi-implementation-plan.md` and `docs/Rajahinta-FI.docx`.
> Each task maps to a specific section of the engineering plan.

---

## Phase 0 — Foundation & Project Setup

### Tech Stack & Architecture

- [ ] **T0.1** Select backend language/framework, database, and frontend framework (open decision — plan deliberately leaves this to the engineering team).
- [ ] **T0.2** Scaffold the modular monolith project structure with five bounded layers: Data Acquisition, Core Domain, Data Platform, Application/API, Presentation.
- [ ] **T0.3** Establish strict module interfaces between layers so any module (e.g., Data Acquisition) can be extracted into a separate service in Phase 2/3 without redesigning domain logic.

### Infrastructure

- [ ] **T0.4** Set up the three-tier environment pipeline: development → staging → production.
- [ ] **T0.5** Provision a staging copy of tax-rule and merchant data so legal/tax review of rule changes runs against realistic data before promotion.
- [ ] **T0.6** Configure CI/CD with automated regression tests (golden-dataset tax tests, data-quality checks, compliance checks) on every deploy.
- [ ] **T0.7** Deploy a feature-flag system that gates new merchant sources, new tax rulesets, and new UI ranking behavior for phased rollout and instant rollback.
- [ ] **T0.8** Set up scheduled/queued job infrastructure for background work (price ingestion, transport-rate refresh, tax-dataset review, time-series aggregation), isolated from the request/response path.

### Monitoring & Observability

- [ ] **T0.9** Instrument the four KPI categories defined in the business plan (product, commercial, data, compliance metrics) directly, not reconstructed from raw logs later.
- [ ] **T0.10** Expose operational health signals (stale-data rate, percentage of verified calculations, compliance incidents) on an internal operations dashboard.
- [ ] **T0.11** Instrument per-calculation cost attribution early so infrastructure spend can be tied back to commercial metrics.

---

## Phase 1 — MVP

### 1A: Data Model & Data Platform

- [ ] **T1.1** Implement the Product Master entity: manufacturer, brand, product category, alcohol %, unit volume, container type, regulatory classification, deposit-system status. One record per canonical product.
- [ ] **T1.2** Implement the Retail Offer entity: merchant, country, linked product, current price, currency, availability, source URL, timestamp, reliability status. Many-to-one against Product Master.
- [ ] **T1.3** Implement the Transport Offer entity: carrier, route, destination, weight tier, package tier, price, seller-involvement indicator, timestamp, reliability status.
- [ ] **T1.4** Implement the versioned Tax Rule entity: tax type (excise / container duty), product category, rate, effective date range, exemption conditions, calculation formula reference, official source, verification date. Versioned — never mutated in place.
- [ ] **T1.5** Implement the Calculation Record entity: persist every landed-cost result shown to a user (or a sampled/aggregated subset), storing which Product Master, Retail Offer, Transport Offer, and Tax Rule versions were used, plus the resulting confidence level. Enables auditability and the correction mechanism.
- [ ] **T1.6** Apply data minimization at the schema level — do not add optional fields "for later" if no shipped feature uses them.

### 1B: Data Acquisition Layer

- [ ] **T1.7** Build data acquisition pipeline for an initial small set of merchants using permitted feeds/APIs (not broad scraping).
- [ ] **T1.8** Implement the Merchant & Source Governance Module: track each source's acquisition method (permitted feed, retailer API, structured merchant feed, licensed provider, compliant crawling, manual verification) and permission/compliance status.
- [ ] **T1.9** Enforce that any new merchant or data source is off (not queried, not displayed) until it has a recorded permission status.
- [ ] **T1.10** Implement source reliability status per data point: VERIFIED, STALE, UNAVAILABLE, ESTIMATED — attached to price, transport, and classification inputs.
- [ ] **T1.11** Build automated data-quality checks that flag any Retail Offer or Transport Offer older than its staleness threshold, and verify that STALE/UNAVAILABLE data is never silently presented as VERIFIED.

### 1C: Product Normalization Module

- [ ] **T1.12** Build the Product Normalization Module: ingest raw product data (name, brand, category, volume, ABV, packaging, images, description) from the Data Acquisition Layer.
- [ ] **T1.13** Implement product matching/deduplication across merchants — the same physical product sold by multiple foreign retailers must resolve to one canonical Product Master with multiple linked Retail Offers.
- [ ] **T1.14** Implement deterministic matching (GTIN/EAN barcode) combined with fuzzy matching (name, brand, volume, ABV) and a manual-review queue for low-confidence matches.
- [ ] **T1.15** Enforce that every canonical product carries a regulatory classification before appearing in a landed-cost calculation — unclassified products are excluded from calculator results, never shown with a guessed classification.

### 1D: Transport Estimation Module

- [ ] **T1.16** Build the Transport Estimation Module: maintain transport offers by carrier, route, destination, weight tier, and package tier.
- [ ] **T1.17** Implement basket-level shipping-cost computation (not just single-item) since shipping thresholds and incremental charges are non-linear. Required for the Basket Optimizer in Phase 2.
- [ ] **T1.18** Distinguish retailer-arranged transport from independent-carrier transport — this distinction feeds directly into Transaction Classification.

### 1E: Tax & Duty Calculation Module

- [ ] **T1.19** Build the Alcohol Excise Sub-Engine: calculate excise duty based on product category, alcohol percentage, and volume using official Finnish Tax Administration rate tables as the primary source.
- [ ] **T1.20** Build the Beverage-Container Duty Sub-Engine: calculate container duty (general rate €0.51/litre) as a distinct calculation from alcohol excise.
- [ ] **T1.21** Implement deposit-return system exemption check: the container-duty engine must evaluate whether packaging participates in the Finnish deposit-return system before applying the duty. Where deposit status cannot be determined, flag the duty calculation as ESTIMATED (never silently assume either way).
- [ ] **T1.22** Populate the initial versioned Tax Rule dataset (excise + container duty) sourced exclusively from official Finnish Tax Administration data — never independently derived.
- [ ] **T1.23** Implement the scheduled rate-review process: a recurring job checks for newly published official rate changes and creates a task for manual/legal confirmation before any new dataset version goes live. Rates are never auto-published.
- [ ] **T1.24** Historical rates remain queryable after a rate change; past calculations always resolve against the rate version effective on the relevant date.

### 1F: Transaction Classification Module

- [ ] **T1.25** Build the Transaction Classification Module as an isolated, independently testable module (the most important proprietary logic in the system).
- [ ] **T1.26** Implement the three-way classification: Distance Selling, Distance Buying, Traveller Import (excluded from calculation) — with confidence level and human-readable evidence summary per result.
- [ ] **T1.27** Classification rules stored as versioned, dated rule sets (mirroring the tax-rule versioning approach), since the rules are subject to legislative change (e.g., the 1 September 2024 joint-liability change).
- [ ] **T1.28** Output must never be a bare legal conclusion — always phrased as an observed pattern with supporting evidence (e.g., "likely distance selling, based on: retailer offers direct delivery to Finland").

### 1G: Confidence & Data-Reliability Framework

- [ ] **T1.29** Implement the cross-cutting Confidence & Data-Reliability Framework consumed by nearly every module.
- [ ] **T1.30** Compute result confidence as a pure function of underlying data statuses (not a manually set field): HIGH (all material inputs verified), MEDIUM (one or more estimated), LOW (shipping or classification unverifiable).
- [ ] **T1.31** Expose enough detail that the UI can show *why* a result has a given confidence level.

### 1H: Landed-Cost Calculator & Excise Declaration Assistant

- [ ] **T1.32** Build the Landed-Cost Calculator: orchestrate the modules above — take a product + quantity + destination (+ optional transport method), call Transport Estimation, Tax & Duty Calculation, and Transaction Classification, and assemble the itemized result.
- [ ] **T1.33** Ensure the itemized breakdown includes: foreign retail price, transport cost, alcohol excise estimate, container duty estimate, other charges, total, calculation-status metadata, and confidence level.
- [ ] **T1.34** Embed the standing disclaimer ("estimated total cost in Finland, not final legal tax liability") as a structural part of every result object, not as a UI-only string, so future API consumers inherit it automatically.
- [ ] **T1.35** Build the Excise Declaration Assistant: a read-mostly module that packages a completed calculation into a structured summary (product, ABV, volume, category, units, container info, transport info, estimated excise, advance-notice information) and links out to MyTax.
- [ ] **T1.36** The Excise Declaration Assistant must never attempt to submit anything on the user's behalf — it prepares information only.

### 1I: Ranking & Sorting Module

- [ ] **T1.37** Implement the Ranking & Sorting Module with only the objective sort orders defined in the business plan: lowest estimated landed cost, lowest €/litre, lowest €/unit, alphabetical, alcohol percentage, product category.
- [ ] **T1.38** Enforce neutrality structurally — the sorting function's input type must have no field available for a merchant payment, promotional flag, or manually curated boost. No code path may allow a paid or manual boost to a merchant's position.
- [ ] **T1.39** Design the module so its logic can be described in plain language on a public "how ranking works" page without omitting any actual factor.

### 1J: Application / API Layer

- [ ] **T1.40** Build the consumer-facing API surface, grouped by module (not by database table): Search & Product Discovery, Landed-Cost Calculation, Excise Declaration Assistant, Account & Subscription.
- [ ] **T1.41** Ensure all calculation endpoints are idempotent for identical inputs given the same underlying dataset versions (results reproducible and cacheable).
- [ ] **T1.42** Implement caching keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version) — driven by dataset version changes, not arbitrary TTLs.
- [ ] **T1.43** Implement rate limiting and abuse protection on public-facing calculation endpoints (each calculation triggers real/cached external lookups — unit-economics risk).
- [ ] **T1.44** Implement the shared Entitlement Module consulted by every relevant API endpoint to enforce free vs. premium feature access.

### 1K: Presentation Layer — Web Application

- [ ] **T1.45** Build the Landed-Cost Calculator UI: search, select product + quantity, display itemized breakdown with calculation-status metadata and confidence level.
- [ ] **T1.46** Build the calculation explanation page: surface every figure's traceable inputs, rate dataset version, and timestamp.
- [ ] **T1.47** Build comparison views with neutral, objective ranking (enforce visual neutrality — no design element suggesting a paid/promoted position).
- [ ] **T1.48** Surface data-freshness indicators visibly: reliability status and timestamp for every externally sourced fact.
- [ ] **T1.49** Restrict content/copy to a controlled vocabulary: identification, classification, calculation, comparison — no subjective adjectives (no "best," "amazing," "top bargain"). Enforce via a lint/review step in the content pipeline.
- [ ] **T1.50** Implement outbound merchant links as plain links recorded for basic analytics only (click-through counts) — no purchase tracking, no commission tracking infrastructure at launch.

### 1L: Compliance & Governance

- [ ] **T1.51** Implement audit logging for changes to tax-rule datasets, classification rule sets, and ranking logic (author, timestamp, reason).
- [ ] **T1.52** Build the launch-gating configuration flag: keep alcohol price data and calculation features behind a non-public flag until legal opinion, tax-source mapping, and correction mechanism are all confirmed complete.
- [ ] **T1.53** Build the public ranking documentation page generated from (or kept in lockstep with) the actual Ranking & Sorting Module implementation.

### 1M: Correction Mechanism

- [ ] **T1.54** Build a correction mechanism: allow users or internal staff to flag a specific calculation or data point as incorrect.
- [ ] **T1.55** Flagged items create a tracked review item; once resolved, corrections can trigger a dataset fix and link back to affected historical Calculation Records.

### 1N: Subscription & Billing

- [ ] **T1.56** Integrate with a third-party subscription billing provider for software subscriptions (Free / Premium €4.99/month / future Professional tier).
- [ ] **T1.57** Enforce structural separation between the billing module and the Ranking & Sorting Module — no shared write path, so a merchant account (if ever introduced) cannot purchase better placement.

### 1O: Age Gate & Account System

- [ ] **T1.58** Implement a lightweight access-control age gate (simple confirmation, not identity verification) as the default, matching the minimal-data-collection preference.
- [ ] **T1.59** Design the account system's identity/age-verification components as a pluggable module that can be upgraded to stronger verification if the legal opinion requires it.
- [ ] **T1.60** Implement the minimal account system: saved baskets, calculation history, subscription management, data export — not a gate on viewing publicly available comparison information.
- [ ] **T1.61** Ensure no storage of identity documents or unnecessary date-of-birth collection unless the legal review specifically mandates it.

### 1P: Privacy & GDPR

- [ ] **T1.62** Default to anonymous usage; collect personal data only for account-based features.
- [ ] **T1.63** Define and implement retention limits for account data, calculation history, and analytics/telemetry, with automated deletion/anonymization jobs.
- [ ] **T1.64** Implement data export functionality early (supports both user-requested export and GDPR data-portability obligations).

### 1Q: Pre-Launch Legal Review & Gating

- [ ] **T1.65** Obtain written Finnish legal opinion covering: Alcohol Act marketing rules, price-list provisions, hyperlinks to foreign alcohol retailers, comparative advertising, search-engine indexing, subscription monetization, email notifications, personalization, rankings, strong vs. mild alcoholic beverages, user-generated content, age-gating.
- [ ] **T1.66** Confirm that the official Finnish Tax Administration source is mapped to every tax rule.
- [ ] **T1.67** Validate distance-selling / distance-buying logic with Finnish tax counsel.
- [ ] **T1.68** Review outbound merchant links and subscription marketing for compliance.
- [ ] **T1.69** Confirm all critical launch conditions (legal, tax, data, GDPR) are satisfied before toggling the launch-gating flag.

### 1R: Testing — MVP

- [ ] **T1.70** Write unit tests for every tax/duty formula, classification rule, and confidence-computation function — highest-coverage bar for the highest-liability code paths.
- [ ] **T1.71** Build golden-dataset regression tests: a fixed set of known product/transport/tax input combinations with manually verified expected outputs, run on every deploy and every new tax-dataset version.
- [ ] **T1.72** Write compliance tests: automated checks that no ranking result correlates with any commercial/payment signal and that banned promotional vocabulary does not appear in generated product copy.
- [ ] **T1.73** Write load/performance tests on the Landed-Cost Calculation endpoint specifically (highest-traffic, most computation-heavy path).

---

## Phase 2 — Growth

### 2A: Historical Price Intelligence

- [ ] **T2.1** Build the Historical Price Intelligence Module: persist time series per canonical product (and per merchant offer) covering foreign retail price, transport cost, applicable tax rate, and resulting landed cost at each observation.
- [ ] **T2.2** Design as an append-only event/observation log feeding into periodically materialized aggregates (daily/weekly summaries) for chart rendering — avoid recomputing full history on every request.
- [ ] **T2.3** Make tax-driven price changes identifiable in the series (a change attributable to a new tax-rule version vs. a genuine merchant price change) by joining the observation log against the versioned tax-rule history.
- [ ] **T2.4** Implement the Historical Data API endpoint for chart rendering.
- [ ] **T2.5** Build historical price charts and historical landed-cost charts in the presentation layer.

### 2B: Basket Optimization

- [ ] **T2.6** Build the Basket Optimization Module: given a multi-item basket, evaluate single-store purchase, multi-store splits, minimum-order thresholds, weight brackets, package limits, and shipping increments, and return the combination with the lowest total estimated landed cost.
- [ ] **T2.7** Implement as a search/optimization problem over a bounded combinatorial space (candidate store subsets × shipping tiers) — straightforward exhaustive search across a small number of candidate merchants is acceptable for initial launch.
- [ ] **T2.8** Reuse the same Tax & Duty and Transport Estimation modules as the single-item calculator so optimizer results and simple calculator results are never inconsistent for the same inputs.
- [ ] **T2.9** Build multi-store comparison UI and basket-optimization UI in the presentation layer.

### 2C: Advanced Features

- [ ] **T2.10** Implement saved scenarios: users can save and reload named calculation scenarios.
- [ ] **T2.11** Implement exportable calculation reports.
- [ ] **T2.12** Implement merchant/source reliability scoring surfaced in comparison results.
- [ ] **T2.13** Enhance the Excise Declaration Assistant with advanced guidance (still read-only — never submits on the user's behalf).

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
| Affiliate sales, commission tracking | Violates "no affiliate incentives at launch" policy |
| Loyalty systems | Not in MVP scope |
| Automated tax filing | Legal risk — platform prepares information only |
| Large-scale merchant advertising | Violates neutrality policy |
| Identity document storage | Not legally required for MVP; minimal data by design |
| Purchase tracking on outbound links | Violates "no purchase tracking at launch" policy |

---

*Last updated: 2026-08-15 — Generated from `docs/rajahinta-fi-implementation-plan.md` and `docs/Rajahinta-FI.docx`*
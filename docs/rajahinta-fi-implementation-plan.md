# Rajahinta.fi — Developer Implementation Plan

**Cross-Border Beverage Price Index & Finnish Landed-Cost Intelligence Platform**

This document translates the business plan into a concrete engineering plan: system architecture, data model, core engines, integration points, delivery phases, and operational requirements. It intentionally contains no code or database schema syntax — it defines *what* must be built and *how the pieces fit together*, leaving implementation language/framework choices to the engineering team.

---

## 1. Guiding Engineering Principles

Before any architecture decisions, the following principles from the business plan translate directly into non-negotiable engineering constraints:

- **The platform is a calculator, not a shop.** No checkout, no payment collection for alcohol, no order management for physical goods. The only commercial transaction in the system is the software subscription.
- **Every number must be explainable.** Every calculated figure (excise, container duty, transport, total) must be traceable back to the exact input values, rate dataset version, and timestamp that produced it.
- **Neutrality is enforced in code, not policy.** Ranking and sorting logic must be objective and deterministic; there must be no code path that allows a paid or manual boost to a merchant's position.
- **Tax data is versioned, never overwritten.** Historical rates must remain queryable after a rate change, so past calculations remain reproducible.
- **Data freshness is a first-class citizen.** Every externally sourced fact (price, shipping cost, tax rate) carries a reliability status and timestamp that is surfaced to the user, not just stored internally.
- **Minimal personal data.** Architecture should default to anonymous usage; identity and age-verification data are only introduced if the legal review requires them, and are handled as a separate, isolated subsystem.

---

## 2. High-Level System Architecture

The system is organized into five cooperating layers:

1. **Data Acquisition Layer** — collects product, price, transport, and tax information from external sources.
2. **Core Domain / Calculation Layer** — the proprietary engine: transaction classification, excise calculation, container duty calculation, transport estimation, and landed-cost aggregation.
3. **Data Platform Layer** — the structured product/merchant/transport/tax database and the historical time-series store.
4. **Application / API Layer** — exposes calculation, search, comparison, and account functionality to the frontend and to future API customers.
5. **Presentation Layer** — the consumer web application (calculator, comparison views, historical charts, account/subscription management).

A supporting **Compliance & Governance Layer** runs across all five layers rather than being a separate service — it enforces neutrality rules, data reliability labeling, and audit logging at each boundary.

### 2.1 Recommended Architectural Style

- A **modular monolith** is recommended for MVP rather than microservices. The calculation engine, classification engine, and data platform are tightly coupled conceptually (a landed-cost result depends on all three simultaneously), and splitting them into separate services prematurely adds latency and consistency risk without commercial benefit at MVP scale.
- Internally, the monolith should be organized into clearly bounded modules (see Section 3) with strict interfaces between them, so that any module (e.g., Data Acquisition) can be extracted into a separate service later (Phase 2/3) without redesigning the domain logic.
- Background/asynchronous work (price ingestion, transport-rate refresh, tax-dataset review, historical time-series aggregation) should run as scheduled and queued jobs separate from the request/response path of the web application, so a slow scrape or feed sync never blocks a user's calculation request.

### 2.2 Environments

- Standard three-tier promotion: development → staging → production.
- Staging must have its own copy of the tax-rule dataset and merchant data so that legal/tax review of rule changes can happen against realistic data before promotion.
- Feature flags should gate any new merchant source, new tax ruleset, or new UI ranking behavior, so compliance-sensitive changes can be rolled out to a small percentage of traffic and rolled back instantly.

---

## 3. Core Domain Modules

### 3.1 Product Normalization Module

Responsible for turning heterogeneous merchant listings into a single canonical product record.

- Ingests raw product data from the Data Acquisition Layer (name, brand, category, volume, ABV, packaging, images, description).
- Performs matching/deduplication across merchants — the same physical product (e.g., a specific wine, vintage, and bottle size) sold by multiple foreign retailers must resolve to one canonical Product Master entity with multiple linked Retail Offers.
- Matching should combine deterministic keys (GTIN/EAN barcode where available) with fuzzy matching (name, brand, volume, ABV) and a manual-review queue for low-confidence matches.
- Every canonical product carries a **regulatory classification** (used later by the excise engine) that must be set before the product can appear in a landed-cost calculation — unclassified products are excluded from calculator results, not shown with a guessed classification.

### 3.2 Transport Estimation Module

- Maintains transport offers by carrier, route, destination, weight tier, and package tier.
- Computes an estimated shipping cost for a given basket (one or more products, quantities, total weight/volume) against a chosen or inferred carrier.
- Distinguishes **retailer-arranged transport** from **independent-carrier transport**, since this distinction feeds directly into the Transaction Classification Module (Section 3.3).
- Supports "basket-level" estimation, not just single-item estimation, because shipping thresholds and incremental charges are non-linear (this is required for the Basket Optimizer in Phase 2).

### 3.3 Transaction Classification Module

This is the platform's most important proprietary logic and should be implemented as an isolated, independently testable module.

- Input: observed transport arrangement (who books/pays the carrier), merchant delivery-to-Finland behavior, and any explicit signals from the merchant's own site (e.g., "we ship to Finland" language, checkout behavior).
- Output: one of three classifications — **Distance Selling**, **Distance Buying**, or **Traveller Import (excluded from calculation)** — each with a confidence level (see Section 3.6) and a human-readable evidence summary.
- The module must never output a bare legal conclusion about a merchant (e.g., "Merchant X is a distance seller") — output should always be phrased as an observed pattern ("likely distance selling, based on: retailer offers direct delivery to Finland") paired with supporting evidence, per the business plan's merchant-classification policy.
- Distance Selling and Distance Buying each trigger different downstream messaging in the Excise Declaration Assistant (Section 3.5) — the classification module's output must be consumed by that module, not re-derived.
- Because the rules that drive this classification (advance notice / guarantee requirements, joint-liability provisions) are themselves subject to legislative change (e.g., the 1 September 2024 joint-liability change referenced in the business plan), classification rules must be stored as versioned, dated rule sets, mirroring the tax-rule versioning approach in Section 3.4.

### 3.4 Tax & Duty Calculation Module

Split into two independently versioned sub-engines, since they have different rules and exemptions:

**a) Alcohol Excise Sub-Engine**
- Calculates excise duty based on product category, alcohol percentage, and volume, using official Finnish Tax Administration rate tables as the primary source rather than independently derived figures.
- Every rate entry stores: tax type, product category, rate value, effective start date, effective end date (nullable for current rates), exemption conditions, calculation formula reference, official source citation, and verification date.
- Rates are never edited in place. A rate change is always a new dataset version with its own effective period; historical calculations always resolve against the rate version that was effective on the relevant date.

**b) Beverage-Container Duty Sub-Engine**
- Calculates the container duty (currently €0.51/litre as a general rate) as a distinct calculation from alcohol excise.
- Must evaluate exemption conditions — most importantly, participation in the Finnish deposit-return system — before applying the duty. This requires the Product Normalization Module to capture and expose deposit-system status per product/packaging combination.
- Where deposit-system status cannot be determined, the duty calculation must be explicitly flagged as ESTIMATED (Section 3.6) rather than silently assumed either way.

**c) Scheduled Rate Review Process**
- A recurring job checks for newly published official rate changes and creates a task for manual/legal confirmation before any new dataset version goes live — rates are never auto-published without a review step, given the tax-calculation risk identified in the business plan.

### 3.5 Landed-Cost Calculation & Excise Declaration Assistant

- **Landed-Cost Calculator**: orchestrates the modules above — takes a product + quantity + destination + (optionally) a chosen or inferred transport method, calls Transport Estimation, Tax & Duty Calculation, and Transaction Classification, and assembles the itemized result: foreign retail price, transport cost, alcohol excise estimate, container duty estimate, other charges, and total. Also emits the calculation-status metadata (classification confirmed / tax dataset version / transport assumption stated).
- **Excise Declaration Assistant**: a downstream, read-mostly module that packages a completed calculation into a structured summary (product, ABV, volume, category, units, container info, transport info, estimated excise, advance-notice information) and links out to the Finnish Tax Administration's MyTax process. This module must never attempt to submit anything on the user's behalf — it prepares information only.
- Both modules must render the standing disclaimer ("estimated total cost in Finland," not "final legal tax liability") as a structural part of every result object, not as a UI-only string, so that API consumers (Phase 2/3) inherit the same disclaimer automatically.

### 3.6 Confidence & Data-Reliability Framework

A cross-cutting module used by nearly every other module:

- **Source reliability status** per data point: VERIFIED, STALE, UNAVAILABLE, ESTIMATED — attached to price data, transport data, and classification inputs.
- **Result confidence level** per calculation: HIGH (all material inputs verified), MEDIUM (one or more inputs estimated), LOW (shipping or classification unverifiable).
- Confidence computation should be a pure function of the underlying data statuses (not a manually set field), so it cannot drift out of sync with the actual data quality.
- The framework must expose enough detail that the UI can show *why* a result has a given confidence level, per the "preserves underlying inputs" requirement in the business plan.

### 3.7 Basket Optimization Module (Phase 2)

- Given a multi-item basket, evaluates single-store purchase, multi-store splits, minimum-order thresholds, weight brackets, and shipping increments, and returns the combination with the lowest total estimated landed cost.
- Should be built as a search/optimization problem over a bounded combinatorial space (candidate store subsets × shipping tiers), not a naive brute force once the merchant count grows — but a straightforward exhaustive search across a small number of candidate merchants is acceptable for initial launch.
- Must reuse the same Tax & Duty and Transport Estimation modules as the single-item calculator, so optimizer results and simple calculator results are never inconsistent for the same inputs.

### 3.8 Historical Price Intelligence Module (Phase 2)

- Persists a time series per canonical product (and per merchant offer) covering foreign retail price, transport cost, applicable tax rate, and resulting landed cost at each observation.
- Should be designed as an append-only event/observation log feeding into periodically materialized aggregates (daily/weekly summaries) for chart rendering, rather than recomputing full history on every request.
- Tax-driven price changes should be identifiable in the series (i.e., a change attributable to a new tax-rule version vs. a genuine merchant price change) — this requires joining the observation log against the versioned tax-rule history from Section 3.4.

### 3.9 Merchant & Source Governance Module

- Tracks each data source's acquisition method (permitted feed, retailer API, structured merchant feed, licensed provider, compliant crawling, manual verification) and its current permission/compliance status.
- Enforces that any new merchant or data source is off (not queried, not displayed) until it has a recorded permission status — prevents accidental use of a non-compliant source.
- Feeds merchant-level reliability scoring, which surfaces in comparison results (Phase 2) as described in the business plan's roadmap.

### 3.10 Ranking & Sorting Module

- Implements only the objective sort orders defined in the business plan (lowest estimated landed cost, lowest €/litre, lowest €/unit, alphabetical, alcohol percentage, product category).
- The sorting algorithm and its inputs must be publicly documentable — this module should be designed so that its logic can be described in plain language on a public "how ranking works" page without omitting any actual factor.
- No field in this module's inputs may originate from a merchant payment, promotional flag, or manually curated boost. This should be enforced structurally (e.g., the sorting function's input type simply has no such field available to it), not just by convention.

---

## 4. Data Architecture (Conceptual)

The business plan specifies four linked entity groups. Each should be modeled as a distinct, independently evolvable data domain:

1. **Product Master** — manufacturer, brand, product category, alcohol %, unit volume, container type, regulatory classification, deposit-system status. One record per canonical product, regardless of how many merchants sell it.
2. **Retail Offer** — merchant, country, linked product, current price, currency, availability, source URL, timestamp, reliability status. Many-to-one against Product Master.
3. **Transport Offer** — carrier, route, destination, weight tier, package tier, price, seller-involvement indicator, timestamp, reliability status. Independent of any single product; consumed by basket-level calculations.
4. **Tax Rule** — tax type (excise / container duty), product category, rate, effective date range, exemption conditions, calculation formula reference, official source, verification date. Versioned; never mutated in place.

A fifth conceptual entity, **Calculation Record**, should persist every landed-cost result actually shown to a user (or at minimum a sampled/aggregated subset), storing which Product Master, Retail Offer, Transport Offer, and Tax Rule versions were used, plus the resulting confidence level. This is what makes results auditable after the fact and is essential for the "correction mechanism" required before launch (Section 8).

Historical time-series data (Section 3.8) should be treated as its own append-only store layered on top of these four entities rather than mixed into their "current state" tables, since current-state lookups and historical analytics have very different access patterns.

---

## 5. Application & API Layer

### 5.1 Consumer-Facing API surface (internal, powering the web app)

Group endpoints by module rather than by database table:

- **Search & Product Discovery** — query canonical products, filter by category/ABV/volume, retrieve linked retail offers.
- **Landed-Cost Calculation** — accept a product + quantity + destination (+ optional transport preference), return the itemized breakdown, classification, confidence level, and disclaimer.
- **Basket Optimization** (Phase 2) — accept a multi-item basket, return optimized store/transport combination.
- **Historical Data** (Phase 2) — retrieve time-series data for a product or merchant for chart rendering.
- **Excise Declaration Assistant** — retrieve the structured summary and official MyTax links for a given completed calculation.
- **Account & Subscription** — saved baskets, calculation history, subscription tier/status, data export.

### 5.2 External/Partner API (Phase 2/3)

- A read-only, rate-limited API exposing historical landed-cost data and aggregated market statistics to the "Professional/Power User" tier described in the business plan (journalists, researchers, analysts).
- Should reuse the same confidence/reliability metadata as the consumer API rather than a stripped-down version, since research/journalism use cases depend on knowing data provenance.
- API access itself should be metered and tied to the subscription/billing module (Section 6), independent of the consumer subscription tiers.

### 5.3 Non-Functional API Requirements

- All calculation endpoints must be idempotent for identical inputs given the same underlying dataset versions, to keep results reproducible and cacheable.
- Cache calculated results keyed by (product, quantity, destination, transport assumption, tax-dataset version, transport-dataset version) — not by wall-clock time — so cache invalidation is driven by dataset version changes rather than arbitrary TTLs, while still respecting a maximum data-age policy for STALE detection.
- Rate limiting and abuse protection are required on public-facing calculation endpoints given that every calculation can trigger downstream merchant/transport lookups (unit-economics risk noted in the business plan).

---

## 6. Subscription & Billing

- Integrate with a third-party subscription billing provider rather than building payment processing in-house; the platform's own commercial transaction is limited to software subscriptions (Free / Premium €4.99/month / future Professional tier), never alcohol purchases.
- Entitlement checks (free vs. premium feature access — multi-store basket optimization, unlimited saved baskets, historical charts, exportable reports, advanced scenario comparison) should be enforced in a single shared entitlement module consulted by every relevant API endpoint, not duplicated per feature.
- Because merchants must never be able to purchase better placement, the billing module must have no code path connecting a merchant account (if one is ever introduced) to the Ranking & Sorting Module's inputs. This should be a structural separation (different services/modules with no shared write path), not just a policy.

---

## 7. Age Gating & Account Architecture

- Implement a lightweight access-control age gate (a simple confirmation, not identity verification) as the default, matching the business plan's stated preference for minimal data collection.
- Design the account system's identity/age-verification components as a pluggable module that can be upgraded to a stronger verification flow if the pre-launch legal opinion requires it — do not hard-code a specific verification vendor or flow into the core account model.
- Accounts exist to support saved baskets, calculation history, subscription management, and data export — not as a functional gate on viewing publicly available comparison information. The application should be usable, at least in a reduced form, without an account.
- No storage of identity documents or unnecessary date-of-birth collection unless the legal review specifically mandates it; this constraint should be reflected in the account data model from day one so it isn't retrofitted under pressure later.

---

## 8. Consumer Protection, Accuracy & Correction Mechanism

- Every calculation result must carry: a calculation timestamp, the data timestamp(s) of each underlying input, the tax-dataset version used, and the computed confidence level (Section 3.6).
- Build a **correction mechanism**: a way for users or internal staff to flag a specific calculation or data point as incorrect, which creates a tracked review item and, once resolved, can trigger a dataset correction and be linked back to any affected historical Calculation Records.
- Maintain automated regression tests for the tax and duty calculation modules covering, at minimum: each product category's excise formula, the container-duty exemption logic (deposit-system participation), and boundary cases around tax-rule effective-date transitions. These tests should run on every change to the calculation modules and on every new tax-dataset version before it is published.

---

## 9. Compliance & Governance Implementation

Translate the business plan's compliance requirements into concrete engineering controls:

- **No promotional language enforcement**: content/copy for product listings should be restricted to a controlled vocabulary or template system (identification, classification, calculation, comparison — no subjective adjectives), ideally enforced via a lint/review step in the content pipeline rather than relying on manual diligence alone.
- **Ranking transparency**: the Ranking & Sorting Module (3.10) should have a corresponding public documentation page generated from (or kept in lockstep with) its actual implementation, so the documented methodology cannot drift from the real behavior.
- **Outbound merchant links**: implement as plain outbound links recorded for basic analytics only (click-through counts) — no purchase tracking, no commission tracking infrastructure at launch, consistent with the "no affiliate incentives at launch" policy. If affiliate tracking is ever added post-legal-review, it must remain structurally isolated from the Ranking & Sorting Module.
- **Audit logging**: log changes to tax-rule datasets, classification rule sets, and ranking logic with author, timestamp, and reason, to support the compliance KPIs (compliance incidents, corrected calculations, percentage of tax rules reviewed after legislative changes).
- **Launch gating**: implement a configuration flag (or equivalent mechanism) that keeps alcohol price data and calculation features behind a non-public flag until the legal opinion, tax-source mapping, and correction mechanism are all confirmed complete — this turns the business plan's "Critical Launch Conditions" (Section 29 of the plan) into an enforced technical gate rather than a manual checklist.

---

## 10. Privacy & GDPR

- Default to anonymous usage; personal data is only collected for account-based features (saved baskets, history, subscription).
- Apply data minimization at the schema level — do not add optional fields "for later" if they are not currently used by a shipped feature.
- Define and implement retention limits for account data, calculation history, and any analytics/telemetry, with automated deletion/anonymization jobs rather than manual cleanup.
- Data export functionality (mentioned as an account feature) should be implemented early, since it supports both the product requirement (users exporting their own calculation history) and GDPR data-portability obligations simultaneously.

---

## 11. Delivery Phases (Engineering View)

### Phase 1 — MVP

Build:
- Product Master, Retail Offer, and Transport Offer data model (current-state only, no historical time series yet)
- Data Acquisition Layer for an initial small set of merchants via permitted feeds/APIs
- Alcohol Excise Sub-Engine and Beverage-Container Duty Sub-Engine, each with versioned rate datasets sourced from official Finnish Tax Administration data
- Transport Estimation Module (single-item / simple basket)
- Transaction Classification Module (Distance Selling / Distance Buying / Traveller Import exclusion)
- Landed-Cost Calculator with itemized breakdown and calculation-status metadata
- Confidence & Data-Reliability Framework
- Excise Declaration Assistant with links to MyTax
- Basic web application: search, calculator, comparison view, calculation explanation page
- Correction mechanism (minimum viable version)
- Age gate (lightweight) and minimal account system (no premium tiers required yet, or a simple Free/Premium toggle if subscriptions launch alongside MVP)

Explicitly deferred: social features, reviews, alcohol recommendations, promotional notifications, affiliate sales, loyalty systems, automated tax filing, large-scale merchant advertising.

### Phase 2

- Historical Price Intelligence Module and time-series storage
- Basket Optimization Module
- Multi-store comparison in the UI
- Saved scenarios and exportable calculation reports
- Advanced tax assistant enhancements
- External/partner API infrastructure
- Merchant/source reliability scoring surfaced in the UI

### Phase 3

- Generalize the Product Master, Tax Rule, and Classification modules to support additional excise-sensitive or cross-border product categories beyond alcohol, each gated behind its own legal/tax review before activation — this should be a configuration-driven extension of existing modules, not a rebuild.

---

## 12. Testing Strategy

- **Unit tests** for every tax/duty formula, classification rule, and confidence-computation function — these are the highest-liability code paths in the system and should have the highest coverage bar.
- **Golden-dataset regression tests**: maintain a fixed set of known product/transport/tax input combinations with manually verified expected outputs; run on every deploy and every new tax-dataset version.
- **Data-quality tests**: automated checks that flag any Retail Offer or Transport Offer older than its staleness threshold, and verify that STALE/UNAVAILABLE data is never silently presented as VERIFIED.
- **Compliance tests**: automated checks (where feasible) that no ranking result correlates with any commercial/payment signal, and that banned promotional vocabulary does not appear in generated product copy.
- **Load/performance tests** on the Landed-Cost Calculation endpoint specifically, since it is the highest-traffic, most computation-heavy path and has real unit-economics implications (Section 26 of the business plan).

---

## 13. Monitoring, Analytics & KPI Instrumentation

Instrument the system to directly produce the KPIs defined in the business plan, rather than reconstructing them from raw logs later:

- **Product metrics**: calculation completion rate, searches per user, saved baskets, basket-optimization usage, return-user rate, calculation accuracy (from the correction mechanism), stale-data rate.
- **Commercial metrics**: free-to-paid conversion, MRR, churn, ARPU, premium feature utilization — sourced from the billing module's entitlement and event logs.
- **Data metrics**: number of normalized products, number of active merchants, price observations per day, transport observations per day, percentage of calculations using verified vs. estimated inputs.
- **Compliance metrics**: number of compliance incidents, number of corrected calculations, percentage of product records with verified source timestamps, percentage of tax rules reviewed after legislative changes.

These should be exposed on an internal operations dashboard, since several of them (stale-data rate, percentage of verified calculations, compliance incidents) are operational health signals, not just business reporting.

---

## 14. Infrastructure & Cost Considerations

- Favor a **hybrid data-freshness architecture**: cached/batch-refreshed product and price data as the default, on-demand transport calculations where thresholds genuinely require freshness, and real-time source verification reserved for cases where it is economically justified (e.g., high-value baskets or premium users) — this directly reflects the unit-economics discussion in the business plan.
- Scheduled jobs (price refresh, transport refresh, tax-rule review) should be independently scalable and independently monitorable, since a stalled job in one domain (e.g., transport data) should not silently degrade the others.
- Since marginal cost per user is non-trivial (each calculation can trigger real or cached external lookups), instrument per-calculation cost attribution early so infrastructure spend can be tied back to the commercial metrics in Section 13.

---

## 15. Summary of Build Order (Critical Path)

1. Product/Retail Offer/Transport Offer data model + initial data acquisition for a small merchant set
2. Versioned Tax Rule dataset (excise + container duty) sourced from official data
3. Transport Estimation Module
4. Transaction Classification Module
5. Landed-Cost Calculator (integrates 1–4) + Confidence Framework
6. Web calculator UI + calculation explanation page
7. Correction mechanism + audit logging
8. Age gate + minimal account system
9. Legal-review gating flag wired through the publish pipeline
10. Subscription/billing integration and entitlement module
11. Phase 2 modules (historical data, basket optimizer, partner API) once Phase 1 is validated

This order mirrors the business plan's own MVP definition while sequencing the compliance-critical infrastructure (versioned tax data, classification module, correction mechanism, launch-gating flag) ahead of commercial features, since the business plan identifies regulatory and tax-calculation risk as the platform's highest-severity risks.

# Phase 1 — MVP

## Why

Phase 0 stood up the scaffold, stack, CI/CD, feature flags, background jobs, and observability. No product code exists yet. Phase 1 builds the actual platform: the cross-border beverage price index and Finnish landed-cost calculator described in `docs/rajahinta-fi-implementation-plan.md`, delivered as the MVP.

## What Changes

- Implement the four core data entities (Product Master, Retail Offer, Transport Offer, versioned Tax Rule) plus the Calculation Record for auditability
- Build the data acquisition pipeline for an initial merchant set with source governance and off-by-default enforcement
- Build the Product Normalization Module (ingest, match/dedupe, regulatory classification gating)
- Build the Transport Estimation Module (single-item and basket-level, retailer vs independent carrier)
- Build the Alcohol Excise and Beverage-Container Duty sub-engines with versioned, officially sourced rate datasets and a manual-review rate-change pipeline
- Build the Transaction Classification Module (Distance Selling / Distance Buying / Traveller Import) as an isolated, versioned, evidence-based module
- Build the Confidence & Data-Reliability Framework (VERIFIED/STALE/UNAVAILABLE/ESTIMATED, HIGH/MEDIUM/LOW)
- Build the Landed-Cost Calculator and the read-only Excise Declaration Assistant
- Build the Ranking & Sorting Module with structurally enforced neutrality
- Build the consumer-facing API surface with idempotency, version-keyed caching, rate limiting, and a shared entitlement module
- Build the web application: calculator, explanation page, comparison views, freshness indicators, controlled-vocabulary copy
- Implement compliance controls: audit logging, launch-gating flag, public ranking documentation
- Build the correction mechanism
- Integrate third-party subscription billing with structural separation from ranking
- Build the age gate, minimal account system, and GDPR measures (retention, data export)
- Execute the pre-launch legal review and wire it into the launch gate
- Write unit, golden-dataset, compliance, and load tests

## Capabilities

### New Capabilities
- `product-data-model`: the four core entities plus the Calculation Record and data-minimization constraint
- `data-acquisition`: ingestion pipeline, merchant/source governance, reliability status, data-quality checks
- `product-normalization`: canonical product matching/deduplication and mandatory regulatory classification
- `transport-estimation`: single-item and basket-level shipping cost estimation, retailer vs independent carrier
- `tax-duty-engine`: excise and container-duty sub-engines, deposit-return exemption, versioned datasets, manual rate-review
- `transaction-classification`: Distance Selling / Distance Buying / Traveller Import, versioned rule sets, evidence-based output
- `confidence-framework`: data-reliability statuses and computed result confidence
- `landed-cost-calculator`: orchestration, itemized breakdown, structural disclaimer, read-only declaration assistant
- `ranking-sorting`: objective sort orders with structural neutrality
- `application-api`: module-grouped API surface, idempotency, version-keyed caching, rate limiting, entitlement
- `web-application`: calculator UI, explanation page, comparison views, freshness indicators, controlled copy, outbound links
- `compliance-governance`: audit logging, launch gating, ranking transparency docs
- `correction-mechanism`: flag incorrect results, tracked review, dataset correction
- `subscription-billing`: third-party billing, structural separation from ranking
- `accounts-age-gate`: age gate, pluggable verification, minimal accounts, GDPR retention and export
- `legal-review-gating`: pre-launch legal opinion and launch-condition confirmation
- `mvp-testing`: unit, golden-dataset, compliance, and load tests

### Modified Capabilities
(none — Phase 0 created only infrastructure capabilities; Phase 1 adds new domain capabilities and consumes, but does not change the requirements of, Phase 0 spec artifacts)

## Impact

- Net-new application code across all five layers (data-acquisition, core-domain, data-platform, application-api, presentation)
- Consumes Phase 0 infrastructure: feature flags (launch gating), background jobs (rate review, ingestion), observability (KPI instrumentation), CI/CD (regression tests)
- No historical time-series, basket optimization, or partner API (Phase 2 scope)
- No payment collection for alcohol; billing is software subscription only
- All touched paths are tentative (greenfield; directory layout follows `docs/tech-stack.md` layer mapping)

## Human-Process Tasks

Group 16 (Pre-Launch Legal Review) consists of five tasks that require a Finnish legal professional — obtaining the legal opinion, confirming tax-source mapping, validating classification logic, reviewing outbound links and marketing, and confirming all launch conditions. These tasks are annotated `agent: none` and cannot be delegated to code agents.
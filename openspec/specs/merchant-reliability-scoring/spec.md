# merchant-reliability-scoring Specification

## Purpose
TBD - created by archiving change phase2-advanced-features. Update Purpose after archive.

## Requirements

### Requirement: Factual merchant reliability score

The system SHALL compute a per-merchant reliability score as a pure aggregation over the merchant's current retail offers: offer count, per-status counts and shares (VERIFIED, ESTIMATED, STALE, UNAVAILABLE), the strictest status, the freshest observation timestamp, and the merchant's governance permission status, plus the computation timestamp. The score SHALL contain no letter grade, weighting, or subjective label (controlled vocabulary), and SHALL be computed from stored data only.

#### Scenario: Aggregation reflects stored statuses

- **WHEN** a merchant's current offers carry a mix of reliability statuses
- **THEN** the score SHALL report the exact counts and shares per status and the strictest status among them

#### Scenario: Governance state surfaced

- **WHEN** a merchant's governance permission status is PENDING
- **THEN** the score SHALL surface that status rather than presenting the merchant as fully verified

#### Scenario: No subjective grades

- **WHEN** the score is serialized for any consumer
- **THEN** it SHALL contain only factual fields (counts, shares, statuses, timestamps) and no grade, rating, or adjective

### Requirement: Surfaced in comparison results

The score SHALL be exposed via a merchant reliability API endpoint and embedded where merchant offers are surfaced in comparison and product-detail contexts, always with its computation timestamp, using controlled-vocabulary labels and neutral equal-treatment styling.

#### Scenario: Score visible next to offers

- **WHEN** comparison results surface a merchant's offers
- **THEN** the merchant's reliability summary SHALL be available alongside them with its timestamp

### Requirement: Informational only — never affects ranking

The reliability score SHALL NOT alter ranking order, sort position, or any ordering of results. The Ranking & Sorting Module SHALL accept no score, reliability-aggregate, or merchant-score field as input, enforced by a lockstep test mirroring the billing-isolation convention.

#### Scenario: Ranking unchanged by score

- **WHEN** the same products are compared before and after scores change
- **THEN** the objective sort order SHALL be identical

#### Scenario: Ranking rejects score inputs

- **WHEN** a score-carrying object is passed to the ranking service
- **THEN** the input SHALL be rejected as an unknown property

### Requirement: Verified share reflects operator verification with ageing

The reliability aggregation SHALL pick up operator-verified offers through its ordinary status aggregation — VERIFIED enters the per-status counts and shares as soon as it is stored — and the score computation itself SHALL remain unchanged: a pure aggregation over stored statuses. Aged VERIFIED offers SHALL degrade to STALE through the freshness job's write-back, governed by the same price-staleness window the data-quality classifier uses — an offer observed at or before the window boundary stays VERIFIED, one strictly past it degrades — and never by a second freshness constant. The write-back SHALL be status-only and idempotent: the price, the observation timestamp, and the verified attribution pair survive the transition, and a re-run over already-STALE rows writes nothing.

#### Scenario: Verified offers surface, then age

- **WHEN** an operator verifies an offer, and the offer's observation later passes the price-staleness window
- **THEN** the merchant's statusCounts first include the offer as VERIFIED and later as STALE, with no change to the aggregation logic

#### Scenario: The window is the classifier's window

- **WHEN** a VERIFIED offer's observation sits exactly at the price-staleness threshold
- **THEN** the offer stays VERIFIED, and only an observation strictly past the threshold degrades to STALE

#### Scenario: Attribution outlives the transition

- **WHEN** an aged VERIFIED offer degrades to STALE
- **THEN** the offer's `verified_at`/`verified_by` pair still records who verified it and when, and its price and observation timestamp are unchanged

### Requirement: Materialized per-request reliability reads

The system SHALL serve per-request merchant reliability aggregates (the product-detail embed and any bounded merchant-set read) from the tick-materialized `merchant_reliability_aggregates` table — one row per merchant, refreshed by the 30-minute aggregation cron after the verified-ageing pass — and the per-request read cost SHALL be independent of catalog size and history depth. The whole-catalog listing path MAY read the same table. A per-request reliability read SHALL NOT scan `retail_offers`.

#### Scenario: Figures identical to the live aggregate

- **WHEN** the materialized aggregates are refreshed for a tick
- **THEN** each merchant row holds exactly the figures the live current-offer aggregate yields for that merchant (offer count, per-status counts, freshest observed_at) under the same deterministic-latest rule

#### Scenario: Merchant-set read is bounded by the table

- **WHEN** a consumer requests aggregates for a set of merchants
- **THEN** the read touches only those merchants' materialized rows and returns them in the deterministic merchant-ascending order

#### Scenario: Staleness bounded by one tick

- **WHEN** the aggregation tick completes
- **THEN** the materialized rows reflect the tick's offer statuses (including VERIFIED→STALE ageing), and no consumer sees aggregates older than one tick

#### Scenario: Cold start fails open

- **WHEN** the materialized table has no row for a requested merchant (pre-first-tick, or a merchant with no current offers)
- **THEN** the merchant is simply absent from the result and the embed degrades to omitting the badge — the system SHALL NOT fall back to a per-request whole-catalog scan

### Requirement: Index-bounded verified-ageing sweep

The periodic VERIFIED→STALE ageing sweep over `retail_offers` SHALL be served by the composite index `(reliability_status, observed_at)` such that its per-tick read cost scales with the offers that actually aged since the previous tick, not with catalog size or observation-history depth. The query plan SHALL use a `SEARCH` on that index (asserted by test), and a full table scan SHALL be treated as a regression.

#### Scenario: Sweep plan is index-bounded

- **WHEN** the ageing sweep statement is explained against migrated schema
- **THEN** the plan searches `retail_offers_reliability_status_observed_at_idx` rather than scanning the table

#### Scenario: Cost independent of history depth

- **WHEN** the observation history grows while the set of newly-aged VERIFIED offers stays small
- **THEN** the sweep's per-tick rows read stays proportional to the newly-aged set, not to total rows

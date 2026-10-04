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

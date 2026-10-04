# merchant-reliability-scoring Delta

## ADDED Requirements

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

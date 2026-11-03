# merchant-reliability-scoring delta

## MODIFIED Requirements

### Requirement: Materialized per-request reliability reads

The system SHALL serve per-request merchant reliability aggregates (the product-detail embed and any bounded merchant-set read) from the tick-materialized `merchant_reliability_aggregates` table — one row per merchant, refreshed by the six-hourly scheduled refresh (`0 */6 * * *`) after the verified-ageing pass of the most recent 30-minute tick — and the per-request read cost SHALL be independent of catalog size and history depth. The whole-catalog listing path MAY read the same table. A per-request reliability read SHALL NOT scan `retail_offers`. The 30-minute verified-ageing sweep itself is unchanged and remains index-bounded.

#### Scenario: Figures identical to the live aggregate

- **WHEN** the materialized aggregates are refreshed
- **THEN** each merchant row holds exactly the figures the live current-offer aggregate yields for that merchant (offer count, per-status counts, freshest observed_at) under the same deterministic-latest rule

#### Scenario: Merchant-set read is bounded by the table

- **WHEN** a consumer requests aggregates for a set of merchants
- **THEN** the read touches only those merchants' materialized rows and returns them in the deterministic merchant-ascending order

#### Scenario: Staleness bounded by one tick

- **WHEN** the six-hourly refresh completes
- **THEN** the materialized rows reflect the most recent 30-minute tick's post-ageing offer statuses, no consumer sees aggregates older than one refresh interval of the new cadence (six hours — this scenario supersedes the former per-30-minute-tick bound), and the display-only embed treats the intervening VERIFIED-count overstatement as accepted tolerance (the ageing threshold is seven days; the figures never feed ranking)

#### Scenario: Cold start fails open

- **WHEN** the materialized table has no row for a requested merchant (pre-first-tick, or a merchant with no current offers)
- **THEN** the merchant is simply absent from the result and the embed degrades to omitting the badge — the system SHALL NOT fall back to a per-request whole-catalog scan

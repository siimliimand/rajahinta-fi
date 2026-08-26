# product-data-model Specification

## Purpose

Adds the storage layer for historical price intelligence: the append-only observation log and the materialized summary tables, with the indexes the aggregator and API depend on.

## ADDED Requirements

### Requirement: price_observations table

The schema SHALL include a `price_observations` table with: product master FK, merchant identifier, retail offer FK, observation timestamp, foreign retail price (cents), transport cost (cents), excise rule version FK, container-duty rule version FK, landed cost (cents), per-input reliability snapshot (JSONB), and aggregate confidence. The table SHALL have indexes on (product, observedAt) and (merchant, product, observedAt).

#### Scenario: Append-only contract

- **WHEN** repositories are generated for `price_observations`
- **THEN** the data-platform repository SHALL expose insert and range-read operations only, with no update or delete API

### Requirement: price_history_summaries table

The schema SHALL include a `price_history_summaries` table with: granularity (daily or weekly), period start, product master FK, merchant (nullable for product-wide rows), open/close/min/max/avg for price and landed cost (cents), observation count, and strictest source reliability. A unique constraint SHALL exist on (granularity, period start, product, merchant), and an index SHALL cover (granularity, product, period start).

#### Scenario: Idempotent upsert key

- **WHEN** the aggregation job upserts a summary for the same granularity, period, product, and merchant twice
- **THEN** the second write SHALL update the existing row rather than duplicate it

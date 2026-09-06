# product-data-model Specification

## MODIFIED Requirements

### Requirement: Retail Offer linkage

Retail offers SHALL link products to merchant prices as before, with merchant, source URL, observed-at, and reliability. After this change every offer SHALL carry the currency `'EUR'` only, and the FX provenance columns (`original_price_cents`, `original_currency`, `fx_dataset_version`) SHALL be dropped from both the Postgres and D1 schemas. The `fx_rate_datasets` and `fx_rates` tables SHALL be dropped.

#### Scenario: Schema carries no FX remnants

- **WHEN** migrations are applied to a fresh Postgres or D1 database
- **THEN** no FX tables exist, `retail_offers` carries no FX provenance columns, and every offer row satisfies the EUR-only invariant

## ADDED Requirements

### Requirement: Merchant removal purge

Removing a merchant SHALL be executable as an auditable purge script that deletes the merchant's registry and governance rows and all queryable product, offer, and price-history-summary rows from the database, while leaving the append-only R2 observation log untouched. Seeds SHALL not contain rows for removed merchants.

#### Scenario: Purge is repeatable and safe

- **WHEN** the purge script runs twice against the same environment
- **THEN** the second run is a no-op, and no `systembolaget` rows exist in any table afterward

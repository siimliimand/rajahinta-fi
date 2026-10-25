# data-acquisition delta

## ADDED Requirements

### Requirement: Bounded current-offer retention

The system SHALL bound the `retail_offers` hot table: a scheduled retention sweep deletes only rows that are both superseded (not the deterministic-latest row for their `(merchant, product_id)` pair under the `observed_at DESC, id DESC` rule) and older than a 30-day window, in bounded cursor-chunked batches. The sweep SHALL run in report-only dry-run mode first, and SHALL NOT leave dry-run mode until the safety preconditions hold: every observation's history is preserved outside the hot table (the R2 observation log mirrors every append and `price_history_summaries` carries the daily aggregates the historical surfaces read), and LANDED_COST provenance citations copy observation fields into their own records rather than foreign-key-referencing `retail_offers`. Current rows and in-window rows SHALL never be deleted. No consumer SHALL lose data: the product-detail current-offer read, the historical price surfaces (summary-materialized), the alert sweeps, and the favorites price drift all keep their exact contracts.

#### Scenario: Dry-run precedes deletion

- **WHEN** the retention sweep first executes in an environment
- **THEN** it reports the candidate row count and window bounds without deleting, and the live mode engages only by explicit configuration change

#### Scenario: Only superseded past-window rows are deleted

- **WHEN** the sweep runs against the migrated schema
- **THEN** every deleted row is older than the 30-day window AND not the deterministic-latest row for its merchant×product pair, and every current or in-window row survives

#### Scenario: History survives outside the hot table

- **WHEN** the sweep deletes superseded rows
- **THEN** the deleted observations remain queryable from the R2 observation log and their daily aggregates from `price_history_summaries`, and the historical price surfaces return unchanged responses

#### Scenario: Provenance citations are unaffected

- **WHEN** the pre-flight assertion inspects LANDED_COST provenance storage
- **THEN** citations read copied observation fields from their own records, and the sweep refuses live mode if any citation foreign-key-references `retail_offers`

#### Scenario: Bounded batches, idempotent re-run

- **WHEN** the candidate set exceeds one batch or the sweep runs twice without new ingests
- **THEN** each execution deletes at most its bounded batch through the advancing cursor, and the second run finds nothing further to delete

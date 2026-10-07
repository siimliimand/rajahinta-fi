# data-acquisition Delta

## ADDED Requirements

### Requirement: Non-alcoholic rows barred from alcohol categories

A feed row whose parsed ABV is zero, or for which no ABV could be parsed, SHALL NOT be assigned into any of the canonical alcohol categories during ingestion. Such rows SHALL still be ingested (the ESTIMATED-status contract for unparseable fields is unchanged) but SHALL be correction-flagged with a hold reason and SHALL NOT appear on any user-facing surface. A row with a parsed ABV greater than zero keeps today's behavior entirely.

#### Scenario: Zero-ABV row is held from alcohol categories

- **WHEN** a feed row parses to ABV 0 (e.g. an energy drink) whose storefront category would map into an alcohol category
- **THEN** the row is ingested with a correction flag and hold reason, and is not assigned into the alcohol category

#### Scenario: Unparseable-ABV row is held, status contract intact

- **WHEN** a feed row has no parseable ABV and would map into an alcohol category
- **THEN** the row ingests as ESTIMATED exactly as before, carries the correction flag and hold reason, and does not appear in the alcohol catalog

#### Scenario: Parsed non-zero ABV is unchanged

- **WHEN** a feed row parses to ABV greater than zero
- **THEN** category mapping and publication behave exactly as before this requirement

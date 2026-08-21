# data-acquisition Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Permitted-source ingestion

The system SHALL acquire product and price data only from permitted feeds, retailer APIs, structured merchant feeds, licensed providers, or compliant crawling, and SHALL record the acquisition method for each source.

#### Scenario: New merchant source

- **WHEN** a new merchant source is onboarded
- **THEN** its acquisition method and permission status SHALL be recorded before any of its data enters the platform

### Requirement: Off-by-default enforcement

A merchant or data source SHALL be off (not queried, not displayed) until it has a recorded permission status.

#### Scenario: Unapproved source

- **WHEN** a source lacks a recorded permission status
- **THEN** the system SHALL NOT query it and SHALL NOT display any of its data

### Requirement: Source reliability status

Every externally sourced data point (price, transport, classification input) SHALL carry a reliability status of VERIFIED, STALE, UNAVAILABLE, or ESTIMATED.

#### Scenario: Stale detection

- **WHEN** a Retail Offer or Transport Offer exceeds its staleness threshold
- **THEN** the system SHALL flag it STALE, and it SHALL NOT be presented as VERIFIED

### Requirement: Scheduled rate review

The rate-review process SHALL run on a recurring scheduled job that checks for newly published official rate changes, rather than a hardcoded stub that always reports no changes.

#### Scenario: New rates detected

- **WHEN** the scheduled job detects newly published official rates
- **THEN** a manual/legal review entry SHALL be created before any dataset version goes live

#### Scenario: No auto-publish

- **WHEN** a rate change is detected
- **THEN** it SHALL never be published automatically; a confirmed review step is required

#### Scenario: Review task recorded

- **WHEN** a rate change review entry is created
- **THEN** it SHALL be persisted with a pending status for operators to inspect

### Requirement: Content linting pipeline step

The pipeline orchestrator SHALL include a content linting step after data mapping and before upsert. The step SHALL run the content linting service against every mapped product's name and description, and SHALL include results in the pipeline run report.

#### Scenario: Lint step runs after mapping

- **WHEN** the pipeline orchestrator executes a run for a merchant
- **THEN** after the DataMappingService maps raw records and before the UpsertPortAdapter persists them, the content linting service SHALL be invoked on the mapped product names

#### Scenario: Lint violations in pipeline report

- **WHEN** a product triggers a content vocabulary violation
- **THEN** the pipeline run report SHALL include the violation detail (pattern matched, matching text, product identifier) in its quality section


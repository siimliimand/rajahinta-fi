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


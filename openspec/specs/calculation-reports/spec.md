# calculation-reports Specification

## Purpose
TBD - created by archiving change phase2-advanced-features. Update Purpose after archive.
## Requirements
### Requirement: Report generation from persisted records

The system SHALL generate calculation reports from the persisted calculation record — figures SHALL be taken verbatim from the record and SHALL NOT be recomputed, such that a report can never diverge from the calculation the user saw. The system SHALL support three formats: JSON (lossless mirror of the stored breakdown, confidence, classification evidence, dataset versions, and disclaimer), CSV (flat line-item rows with proper escaping), and HTML (printable report suitable for browser print-to-PDF, without introducing a PDF library dependency).

#### Scenario: JSON report

- **WHEN** a user requests a report in JSON format
- **THEN** the response SHALL mirror the persisted record's structured breakdown, disclaimer, confidence, classification evidence, and dataset versions

#### Scenario: CSV report

- **WHEN** a user requests a report in CSV format
- **THEN** the response SHALL be a flat line-item table where every row carries its label, category, amount, reliability status, dataset version, and timestamp, with values escaped per RFC 4180

#### Scenario: Printable report

- **WHEN** a user requests a report in HTML format
- **THEN** the response SHALL be a self-contained printable report using controlled-vocabulary labels

### Requirement: Structural disclaimer in exports

The standing disclaimer SHALL be a structural part of every exported report format — a structural row in CSV, a field in JSON, a rendered block in HTML — never omitted or reduced to presentation-only content.

#### Scenario: Disclaimer present in every format

- **WHEN** a report is generated in any format
- **THEN** the disclaimer text, language, and version SHALL be included in the output

### Requirement: Report provenance

Every figure in an exported report SHALL carry its reliability status, dataset version, and timestamp, following the architecture rule that every externally sourced fact carries provenance.

#### Scenario: Provenance on every line

- **WHEN** a report line derives from an ESTIMATED or STALE input
- **THEN** the report SHALL surface that reliability status alongside the figure

### Requirement: Report access control

The report endpoint SHALL require the `calculation:export` entitlement (PREMIUM tier), SHALL be rate-limited, and SHALL be gated by the `enable_advanced_features` feature flag.

#### Scenario: Free tier denied

- **WHEN** a user without sufficient entitlement requests a report
- **THEN** the endpoint SHALL reject the request with an entitlement error

#### Scenario: Flag off blocks reports

- **WHEN** the `enable_advanced_features` flag is disabled
- **THEN** the report endpoint SHALL not serve requests


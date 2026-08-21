# landed-cost-calculator Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Cross-module orchestration

The Landed-Cost Calculator SHALL take a product + quantity + destination (+ optional transport method and transport arrangement), call Transport Estimation, Tax & Duty Calculation, and Transaction Classification, and assemble an itemized result. The transport arrangement (who arranges carriage: seller-arranged, independent carrier engaged by the buyer, or personal transport by the buyer) SHALL be a caller-supplied input passed through to Transaction Classification — the calculator SHALL NOT hardcode any classification input.

#### Scenario: End-to-end calculation

- **WHEN** a user submits a product and quantity
- **THEN** the calculator SHALL return the itemized result produced by the downstream modules, reusing their outputs rather than re-deriving them

#### Scenario: Classification inputs are caller-supplied

- **WHEN** the calculator invokes Transaction Classification
- **THEN** every classification signal SHALL derive from request inputs or retrieved data, and no classification-relevant boolean SHALL be hardcoded in the orchestrator

### Requirement: Itemized breakdown

The result SHALL include foreign retail price, transport cost, alcohol excise estimate, container duty estimate, other charges, total, calculation-status metadata, and confidence level.

#### Scenario: Full breakdown present

- **WHEN** a calculation completes
- **THEN** every itemized figure SHALL be present with its traceable inputs, dataset version, and timestamp

### Requirement: Structural disclaimer

The standing disclaimer ("estimated total cost in Finland, not final legal tax liability") SHALL be a structural part of every result object, not a UI-only string, so API consumers inherit it automatically.

#### Scenario: API result carries disclaimer

- **WHEN** a result is serialized for any consumer (UI or API)
- **THEN** the disclaimer SHALL be present in the result object itself

### Requirement: Read-only declaration assistant

The Excise Declaration Assistant SHALL package a completed calculation into a structured summary (product, ABV, volume, category, units, container info, transport info, estimated excise, advance-notice information) and link out to MyTax, and SHALL never submit anything on the user's behalf.

#### Scenario: No submission

- **WHEN** the assistant is invoked
- **THEN** it SHALL only prepare and display information, with no capability to transmit a declaration


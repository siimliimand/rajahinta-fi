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

The itemized result SHALL contain retail price, transport, alcohol excise, and container duty, each with reliability status and timestamp. It SHALL additionally contain an import-VAT line when the offer's seller country differs from the destination: the VAT amount, the rate version id, the base breakdown, and a reliability status. The line SHALL be absent for domestic offers, and absence SHALL mean zero contribution to the total, not a displayed zero. `totalCents` SHALL include the import-VAT amount exactly when the line is present. The response and the persisted calculation record SHALL also carry the optional `alkoBenchmark` object as before: absent when no Alko reference offer exists, excluded from `totalCents` and the itemized array, display-only. Records created before this change lack any VAT line, and consumers SHALL treat absence as normal.

#### Scenario: Foreign seller carries import VAT

- **WHEN** a calculation runs for an alks.fi offer (seller country DE) into FI
- **THEN** the result contains an import-VAT line with amount, rate version, and base breakdown, and the total includes it

#### Scenario: Domestic offer unchanged

- **WHEN** a calculation runs for an Alko offer
- **THEN** no VAT line exists, the total equals the pre-change engine's output for the same inputs, and the response renders normally

#### Scenario: Pre-change record stays readable

- **WHEN** a calculation record created before this change is fetched
- **THEN** it has no VAT line, and consumers render it without error or placeholder

## ADDED Requirements

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

### Requirement: Offer-constrained calculation entrypoint

The Landed-Cost Calculator SHALL expose an internal entrypoint that computes item costs (retail price, alcohol excise, container duty, per-input reliability, classification, confidence) for a caller-specified retail offer, running the same engine code paths as the public single-product calculation. The public single-product behavior, including automatic selection of the lowest-priced offer, SHALL remain unchanged.

#### Scenario: Pinned-offer calculation matches engine outputs

- **WHEN** a caller requests the item-cost computation for a specific retail offer
- **THEN** the result SHALL be produced by the same tax, duty, classification, and confidence steps as the public calculation for that offer

#### Scenario: Public behavior unchanged

- **WHEN** a user runs a single-product calculation after this change
- **THEN** the result SHALL be identical to the prior behavior, selecting the lowest-priced offer automatically

### Requirement: Declaration advanced guidance

The Excise Declaration Assistant SHALL augment its structured summary with an advanced-guidance section, computed from the persisted calculation record: (a) a derivation walkthrough of the excise estimate — product category, ABV, volume, quantity, applied excise and container-duty rates with their rule version labels and formula references; (b) the advance-notice deadline computed from the calculation timestamp when the classification requires notice; (c) an ordered, informational MyTax entry checklist phrased as observed patterns, not legal conclusions; (d) confidence-driven caveats — LOW result confidence, unknown deposit-return status (tri-state null → ESTIMATED container duty), and fallback tax-dataset version; and (e) links to official Finnish Tax Administration guidance alongside the existing MyTax link. The guidance SHALL remain strictly read-only: the assistant SHALL never submit, pre-fill, or transmit anything on the user's behalf, and the existing type-level read-only safety proofs SHALL continue to hold.

#### Scenario: Derivation present

- **WHEN** a declaration summary is prepared for a calculation record
- **THEN** the guidance SHALL include the applied rates with their rule version labels and the formula reference used

#### Scenario: Deadline computed

- **WHEN** the classification requires an advance notice with a deadline in days
- **THEN** the guidance SHALL include the computed due date derived from the calculation timestamp

#### Scenario: Caveats on uncertain data

- **WHEN** the underlying calculation has LOW confidence or an unknown deposit-return status
- **THEN** the guidance SHALL surface the corresponding caveat rather than presenting the estimate as certain

#### Scenario: Guidance never submits

- **WHEN** any guidance path is exercised
- **THEN** the assistant SHALL only prepare and display information, with no capability to transmit a declaration — the no-submission guarantee SHALL hold unchanged

### Requirement: Single-currency totals

Every calculation SHALL be expressed in EUR, and the system SHALL enforce this as a type-level invariant: the offer currency union contains only the `'EUR'` literal, offers carry no conversion provenance, and the unconvertible-offer exclusion path SHALL NOT exist. A data-quality invariant SHALL verify that every stored offer is EUR so a future non-EUR feed fails checks rather than silently corrupting totals.

#### Scenario: Every stored offer is EUR

- **WHEN** the data-quality suite runs against any environment
- **THEN** zero offers carry a currency other than EUR, and the suite fails if the invariant is violated

#### Scenario: No conversion code path

- **WHEN** the repository is searched for FX conversion or unconvertible-offer handling in the calculator and ingestion paths
- **THEN** no such code exists

### Requirement: Domestic reference benchmark is display-only

The Alko benchmark SHALL never enter any calculation input, the landed-cost total, or any ranking input. Result output SHALL be byte-identical whether zero, one, or many Alko reference offers exist for unrelated purposes. Benchmark wording in both locales SHALL be factual and pass the content-policy lint.

#### Scenario: Output invariance

- **WHEN** the same calculation inputs run against datasets containing zero, one, or many Alko reference rows
- **THEN** the calculated totals, breakdown, confidence, and ranking inputs are byte-identical across all three runs, and only the optional benchmark field varies

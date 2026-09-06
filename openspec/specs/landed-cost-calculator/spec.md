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

The itemized result SHALL contain retail price, transport, alcohol excise, and container duty as before, each with reliability status and timestamp. The response and the persisted calculation record SHALL additionally carry an optional `alkoBenchmark` object: the product's Alko reference price, the difference against the calculated offer in euros and percent, the reference's reliability status, and its observation timestamp. The field SHALL be absent when no Alko reference offer exists for the product, SHALL be excluded from `totalCents` and from the itemized array, and SHALL be display-only. Records created before this change lack the field, and consumers SHALL treat absence as normal.

#### Scenario: Benchmark present

- **WHEN** a calculation runs for a product that has an Alko reference offer
- **THEN** the result and its persisted record carry `alkoBenchmark` with price, difference, percent, reliability, and timestamp, and the total equals the itemized breakdown without it

#### Scenario: Benchmark absent

- **WHEN** a calculation runs for a product with no Alko reference offer, or a pre-change record is fetched
- **THEN** the field is absent, the response and page render normally, and no placeholder or guess is shown

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

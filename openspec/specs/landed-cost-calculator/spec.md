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

### Requirement: Result presentation

The calculator SHALL present its result answer-first: the estimated landed
cost as the primary figure, followed by the explicit difference against the
Finland reference, then the full breakdown beneath. The breakdown figures
SHALL remain traceable to the result object's inputs (existing explainability
contract, unchanged). The result card SHALL surface the data reliability
status and timestamp carried by the underlying data, using the existing
reliability-status model, and SHALL render the structural disclaimer from the
result object exactly once: as an amber banner when result confidence is LOW,
as a quiet neutral one-liner otherwise, with the disclaimer text byte-identical
to the result object's field. Tax-line category labels SHALL carry no estimate
qualifier — excise, container duty, and import VAT are deterministic given
classification — and estimate-ness SHALL be carried by the per-value
reliability status indicators; the transport line SHALL keep an explicit
estimate label when no transport offer was selected. The confidence breakdown
SHALL be reachable from the result presentation (behind the derivation
disclosure) rather than always-on; degraded-state sanity notes SHALL remain
visible when result confidence is LOW, naming the degraded input directly
(the former generic framing label is retired). When an empirical margin is
composed for the result, the calculator result view SHALL render it beside
the primary figure with its sample count and as-of date, as a display-only
figure.

#### Scenario: Answer before breakdown

- **WHEN** a calculation completes
- **THEN** the landed cost and Finland difference appear before any breakdown,
  with the explicit cheaper/dearer text — the comparison is never conveyed by
  color alone

#### Scenario: Freshness is visible

- **WHEN** a result renders
- **THEN** the card shows the reliability status and observation timestamp of
  the price data feeding the result

#### Scenario: Disclaimer comes from the result object

- **WHEN** a result renders
- **THEN** the disclaimer text rendered is the result object's structural
  disclaimer field

#### Scenario: One disclaimer per result

- **WHEN** the result card renders
- **THEN** the structural disclaimer text appears exactly once, amber at LOW
  confidence and quiet otherwise

#### Scenario: Deterministic taxes are not labeled as estimates

- **WHEN** the breakdown lists excise, container duty, or import VAT
- **THEN** the line labels carry no estimate qualifier, and the line's
  reliability status dot is the only estimate signal

#### Scenario: Breakdown detail stays reachable

- **WHEN** a reader wants to know why a result carries its confidence level
- **THEN** the per-input breakdown is available behind the derivation
  disclosure in one interaction

#### Scenario: Margin shows its basis

- **WHEN** a calculator result view renders a composed empirical margin
- **THEN** the ± figure, relative percent, sample count, and as-of date render
  beside the primary figure, and every monetary figure is unchanged

### Requirement: Quick and advanced calculation

The calculator SHALL offer a quick path (country, product, price, quantity) with advanced options (travel costs, fuel, ferry, quantities, other costs) collapsed by default. Quick-path results SHALL equal full-path results given the same inputs; advanced inputs only add terms.

#### Scenario: Quick path is the default

- **WHEN** the calculator loads
- **THEN** only the quick-path inputs are visible, with advanced options available behind an explicit control

### Requirement: Input units and validation

Calculator inputs SHALL display their unit beside the field (e.g. `320 km`, `6.5 L / 100 km`), SHALL use numeric keyboards on mobile, and SHALL validate inline with specific error messages.

#### Scenario: Units are unambiguous

- **WHEN** a numeric input renders
- **THEN** its unit is visible adjacent to the field in both locales

### Requirement: Sticky summary

On desktop viewports the calculator SHALL render a summary card that stays visible while inputs change, showing the running landed-cost estimate and the Finland comparison.

#### Scenario: Summary persists during input

- **WHEN** the visitor scrolls or edits inputs on a desktop viewport
- **THEN** the summary card remains visible and reflects current inputs

### Requirement: Result confidence and reliability

Every calculation result SHALL carry an overall confidence level and per-component reliability statuses. In addition, the calculator SHALL apply a plausibility sanity rail: when a line's excise estimate exceeds 5× that line's foreign retail price (named, documented constant), the result's overall confidence SHALL be LOW, the affected component's reliability SHALL read ESTIMATED rather than VERIFIED, and the result SHALL carry machine-readable sanity notes explaining the downgrade. The rail SHALL never alter any computed amount: totals and line figures remain byte-identical to a rail-less calculation with the same inputs.

#### Scenario: Plausible calculation is unaffected

- **WHEN** a calculation's excise is within 5× of the retail price
- **THEN** the result carries no sanity notes and its confidence/statuses follow the normal reliability model

#### Scenario: Absurd excise degrades visibly

- **WHEN** a line's excise exceeds 5× that line's retail price (for example a unit-conversion regression producing €10,693 of excise on a €98.70 basket)
- **THEN** the overall confidence is LOW, the excise component reads ESTIMATED, and `sanityNotes` names the threshold breach

#### Scenario: The rail never changes amounts

- **WHEN** the same inputs are calculated with and without the rail condition being met
- **THEN** every monetary figure is identical; only confidence, statuses, and the notes differ

#### Scenario: Golden dataset stays green

- **WHEN** the golden regression suite runs against sane fixtures
- **THEN** no fixture trips the rail and all expected totals are unchanged

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

### Requirement: Traveller-import calculation mode

The calculator SHALL support a traveller-import mode (`transportArrangement: 'PERSONAL'`) that computes the out-of-pocket cost for goods carried by the buyer across the border within Finnish traveller allowances. The mode SHALL resolve the published traveller-allowance dataset effective on the transaction date via the traveller-allowance port and apply its per-category caps to the requested quantity: the allowed portion carries retail price only (no excise, container duty, or import VAT), and any over-allowance surplus is taxed with the existing engines and the established import-VAT base composition. The result SHALL name the allowance dataset version it applied and SHALL label the single-traveller assumption. Absence of a published effective dataset SHALL reject the calculation with the same honest message shape the trip routes use; the delivery mode SHALL remain available in that case, and caps SHALL never be invented.

#### Scenario: Quantity within the category cap is shelf price only

- **WHEN** a PERSONAL-mode calculation requests 6 × 1 l of a 40% spirit whose category cap covers 6 l
- **THEN** the result totals the shelf price only, with excise, container duty, and import VAT zero for the allowed portion, and the result metadata names the allowance dataset version

#### Scenario: Surplus over the cap is taxed on the surplus only

- **WHEN** a PERSONAL-mode calculation exceeds the product's category cap
- **THEN** only the surplus quantity carries excise, container duty, and import VAT, computed with the existing engines and base composition, and the itemized breakdown separates the allowed and surplus portions

#### Scenario: No effective allowance dataset rejects honestly

- **WHEN** no published traveller-allowance dataset is effective on the transaction date and the mode is PERSONAL
- **THEN** the calculation rejects with the no-dataset message (trip-route parity) and no result is produced with invented caps

#### Scenario: Delivery mode is unchanged

- **WHEN** the request omits `transportArrangement` or sends a delivery arrangement
- **THEN** the calculation, its amounts, and its cache identity are identical to the pre-change behavior

### Requirement: Traveller-alternative estimate on delivery results

Delivery-mode calculation results SHALL carry an additive, optional `travellerAlternative` estimate: the labeled out-of-pocket figure for one traveller carrying the same quantity within the effective allowance caps, with the allowance dataset version and category key. The estimate SHALL be null when no effective dataset exists, when the product's category has no cap row, or when the request was already traveller-mode. Delivery-mode amounts, statuses, and confidence SHALL NOT be altered by the callout's presence.

#### Scenario: Delivery result carries the labelled traveller estimate

- **WHEN** a delivery-mode calculation returns for a product whose category has an effective cap
- **THEN** the result carries `travellerAlternative` with the estimate, the dataset version, and the category key, and all delivery-mode figures are unchanged

#### Scenario: No cap row yields no callout

- **WHEN** the product's category has no row in the effective allowance dataset
- **THEN** `travellerAlternative` is null and the result renders as before

# web-application Delta

## MODIFIED Requirements

### Requirement: Traveller callout on delivery results

Delivery-mode calculation results SHALL render the `travellerAlternative` estimate when present as a co-equal labeled estimate block positioned adjacent to the hero total (allowance framing, dataset version), not as a section below the cost breakdown — so both transaction-shaped totals are visible at the same rank for a domestic destination. The block keeps its link into the trip calculator pre-filled with the product and quantity (`/trip?product={id}&quantity={n}`). Delivery-mode amounts render exactly as before; the traveller block never replaces, restyles, or degrades them, and the callout's conditional presence (live delivery-mode POST responses only, never persisted GET results) is unchanged.

#### Scenario: Traveller estimate sits beside the hero total

- **WHEN** a delivery result for a domestic destination carries a non-null `travellerAlternative`
- **THEN** the page shows the labeled traveller estimate block adjacent to the hero total, and every delivery amount is byte-identical to the response

#### Scenario: Callout links into a pre-filled trip

- **WHEN** a delivery result carries a non-null `travellerAlternative`
- **THEN** the traveller block's link opens the trip calculator with the product and quantity pre-seeded

#### Scenario: Trip page accepts the prefill

- **WHEN** the trip page is opened with `product` and `quantity` query parameters
- **THEN** the fill form is pre-seeded with that product and quantity and the existing validation applies unchanged

## ADDED Requirements

### Requirement: Localized transaction classification display

The calculator result SHALL render the transaction classification label and the classification evidence in the active locale. The label SHALL be localized from the classification enum value; the evidence SHALL be localized on the client from an additive, closed-set machine-readable `code` carried on each evidence detail alongside the existing English observation text. The API's English `evidenceSummary` field SHALL remain unchanged for API consumers, and localization SHALL NOT alter any classification outcome, confidence value, or monetary figure.

#### Scenario: Finnish locale renders Finnish classification text

- **WHEN** a calculation result is rendered under the `fi` locale
- **THEN** the classification label and evidence line appear in Finnish, composed from the enum value and the evidence codes

#### Scenario: Evidence codes are additive on the wire

- **WHEN** any calculation result is serialized
- **THEN** each evidence detail carries its new machine-readable `code` while the existing `observation` and result-level `evidenceSummary` fields remain byte-identical to their previous values

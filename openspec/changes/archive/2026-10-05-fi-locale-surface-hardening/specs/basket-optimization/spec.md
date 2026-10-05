# basket-optimization Delta

## ADDED Requirements

### Requirement: Localized basket result presentation

The basket optimization result SHALL render every cost-line label and reliability-explanation sentence in the active locale. The optimization API SHALL carry an additive, closed-set machine-readable `code` on each cost line alongside the existing English `label`, which SHALL remain byte-identical on the wire for API consumers. The basket result (and the share snapshot rendering of a basket) SHALL compose labels and explanation sentences from the locale's message catalog using the `code`, and SHALL fall back to the verbatim API label for any line whose code is unknown. Localization SHALL NOT alter any cost figure, reliability status, confidence value, ranking outcome, or the recommended combination.

#### Scenario: Finnish locale renders Finnish line labels

- **WHEN** a basket optimization result is rendered under the `fi` locale
- **THEN** every cost line renders its Finnish label (e.g. "Vähittäishinta", "Alkoholivalmistevero") composed from the line's `code`, and no English line label appears

#### Scenario: Reliability explanations render in the active locale

- **WHEN** the result's data-reliability section is rendered under the `fi` locale
- **THEN** each explanation sentence is composed in Finnish from the input's dimension and status, and no English sentence appears

#### Scenario: Unknown codes fall back to the API label

- **WHEN** a result carries a cost line whose `code` is not in the closed set
- **THEN** the line renders the verbatim API `label`, and all amounts remain byte-identical

#### Scenario: Wire contract is additive only

- **WHEN** the optimization API response is serialized
- **THEN** each cost line carries its new `code` while the existing `label` and every monetary figure remain byte-identical to their previous values

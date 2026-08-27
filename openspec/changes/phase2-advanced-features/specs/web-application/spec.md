# web-application Specification Delta

## ADDED Requirements

### Requirement: Scenario controls in the calculator UI

The calculator UI SHALL provide a save-scenario control (name input plus save action) and a scenario picker to load a saved scenario; loading SHALL repopulate the calculator inputs and re-run the calculation against current data. The account page SHALL list the user's saved scenarios. These controls SHALL be hidden when the `enable_advanced_features` flag is off.

#### Scenario: Save and reload from the UI

- **WHEN** a user saves the calculator state under a name and later loads it
- **THEN** the inputs SHALL be repopulated and a fresh calculation SHALL run

#### Scenario: Flag off hides scenario controls

- **WHEN** the flag is disabled
- **THEN** the save/load controls SHALL not be rendered and no scenario request SHALL be made

### Requirement: Report export affordance

The calculator result view and the account calculation-history entries SHALL provide export actions for the report formats (JSON download, CSV download, print report). Export labels SHALL use controlled vocabulary.

#### Scenario: Export from a result

- **WHEN** a user activates an export action on a calculation result
- **THEN** the corresponding report SHALL be downloaded or opened for printing, carrying the disclaimer and per-line provenance

### Requirement: Merchant data-freshness display in comparisons

Where comparison results surface a merchant's offers, the UI SHALL display the merchant's factual data-reliability summary (counts/shares per status, freshest observation, governance status) with its timestamp, using controlled-vocabulary labels and neutral equal-treatment styling. The display SHALL NOT alter or suggest any change to the objective sort order.

#### Scenario: Factual freshness line

- **WHEN** a merchant's offers are shown in a comparison
- **THEN** a factual reliability summary with timestamp SHALL be visible near the offers, styled identically for every merchant

### Requirement: Declaration guidance panel

The calculator result detail page SHALL render the declaration assistant's advanced guidance (derivation, deadline, checklist, caveats) in a clearly bounded panel using observed-pattern phrasing, visible when the `enable_advanced_features` flag is on.

#### Scenario: Guidance rendered

- **WHEN** a user expands the declaration guidance panel on a result
- **THEN** the derivation, deadline, checklist, and any caveats SHALL be displayed with the standing disclaimer

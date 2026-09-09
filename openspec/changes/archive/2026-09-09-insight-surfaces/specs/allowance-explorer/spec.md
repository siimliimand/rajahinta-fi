# allowance-explorer Specification

## ADDED Requirements

### Requirement: Date-addressable allowance browsing

A public API endpoint SHALL return the published traveller-allowance dataset version effective on a requested calendar date (defaulting to today), including every category's volume or quantity caps, the dataset version label, the effective window, and the verbatim source citations for the dataset and for each limit. A companion endpoint SHALL list the published dataset versions with their effective windows so past versions remain queryable. Both endpoints SHALL be age-gated and rate-limited, and SHALL be strictly read-side over the existing append-only repository with no write path to PUBLISHED datasets.

#### Scenario: Date resolves to effective version

- **WHEN** the endpoint is queried with a date falling under a published dataset version
- **THEN** the response SHALL contain that version's caps per category with its version label, effective window, and citations

#### Scenario: Unpublished versions excluded

- **WHEN** a dataset version exists only in PENDING_CONFIRMATION status
- **THEN** no endpoint SHALL return its caps and the date resolution SHALL skip it

#### Scenario: Past versions remain queryable

- **WHEN** the versions endpoint is queried
- **THEN** it SHALL list published versions with their effective windows, including superseded ones

#### Scenario: No date resolves

- **WHEN** the requested date precedes every published version's effective-from
- **THEN** the endpoint SHALL return an explicit not-found result rather than a guessed version

### Requirement: Allowance page renders evidence, not conclusions

The `/allowances` page SHALL render the resolved dataset as a date-addressable view: a date picker defaulting to today, per-category caps, the version label and effective window, and each source citation rendered verbatim as an evidence link. The page SHALL carry standing "guidance, not legal advice" framing and SHALL NOT paraphrase citations into legal conclusions. The page SHALL include a version-history section fed by the versions endpoint.

#### Scenario: Citations rendered verbatim

- **WHEN** a visitor views the allowances page for any date
- **THEN** each category cap SHALL be shown with its citation as an evidence link, unmodified from the stored text

#### Scenario: Version provenance visible

- **WHEN** the page renders any resolved dataset
- **THEN** the version label and effective window SHALL be visible next to the caps

#### Scenario: Read-only guarantee

- **WHEN** any allowance-explorer endpoint or page is exercised
- **THEN** no PUBLISHED dataset row SHALL be created, modified, or unpublished by that path

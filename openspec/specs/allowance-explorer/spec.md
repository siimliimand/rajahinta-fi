# allowance-explorer Specification

## Purpose
TBD - created by archiving change insight-surfaces. Update Purpose after archive.

## Requirements

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

The `/allowances` page SHALL render the resolved dataset as a date-addressable view: a date picker defaulting to today, per-category caps each with a concise Finnish summary line (category name and cap), the version label and effective window, and a static per-category container-equivalent helper (display-only arithmetic converting the cap into common container counts — e.g. 10 l ≈ 20 × 0,5 l — phrased within the controlled vocabulary). Every stored source citation SHALL reach the page verbatim and unmodified, rendered as an evidence link inside a collapsed evidence disclosure per dataset block rather than repeated inline on every category row; the dataset-level citation SHALL remain verbatim, inline, and visible on the page. The server SHALL continue to pass each stored citation string through unmodified (`sourceCitation`); the restructure is presentational only. The page SHALL carry standing "guidance, not legal advice" framing and SHALL NOT paraphrase citations into legal conclusions. The page SHALL include a version-history section fed by the versions endpoint.

#### Scenario: Citations rendered verbatim

- **WHEN** the allowances page renders a resolved dataset version
- **THEN** each category's stored citation appears inside the evidence disclosure exactly as stored, as an evidence link, unmodified from the stored text

#### Scenario: Version provenance visible

- **WHEN** the page renders any resolved dataset
- **THEN** the version label and effective window SHALL be visible next to the caps

#### Scenario: Read-only guarantee

- **WHEN** any allowance-explorer endpoint or page is exercised
- **THEN** no PUBLISHED dataset row SHALL be created, modified, or unpublished by that path

#### Scenario: Finnish summary per category

- **WHEN** the allowances page renders a category cap
- **THEN** the row shows a concise Finnish summary line and the full verbatim citation remains available through the evidence disclosure

#### Scenario: Container equivalents are display-only arithmetic

- **WHEN** a category renders its cap
- **THEN** the container-equivalent helper states a plain arithmetic conversion of the cap and contains no advice phrasing

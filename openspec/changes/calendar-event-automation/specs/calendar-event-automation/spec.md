# calendar-event-automation Specification

## Purpose

Keep the tax-change calendar truthful and current without hand-maintaining it: mechanical rhythm rows generate themselves, confirmed rate datasets fan out into calendar events at the existing human gate, and source announcements arrive as review candidates that only an operator can publish.

## ADDED Requirements

### Requirement: Automatic rhythm-skeleton generation

The system SHALL automatically create the coming year's two `ALKO_PRICE_LIST` calendar events as EXPECTED rows with expected windows `YYYY-03` and `YYYY-09`, FI/EN text from versioned constants, and the official Alko rhythm statement as the source. Generation SHALL be idempotent: a year already carrying either Alko row SHALL be skipped in full, and no generated row SHALL ever have status CONFIRMED. Generation SHALL NOT create events of any other type.

#### Scenario: Rerun does not duplicate

- **WHEN** skeleton generation runs twice for the same year
- **THEN** the second run SHALL create no additional rows

#### Scenario: Generated rows are rhythm only

- **WHEN** skeleton rows are created
- **THEN** each SHALL have status EXPECTED with a month window, the rhythm source, and never an exact occurrence date

### Requirement: Calendar event fan-out at the rate-confirmation gate

When an operator confirms a rate-dataset version whose effective year has no `FI_EXCISE_CHANGE` event yet, the system SHALL automatically create the CONFIRMED event effective 1 January of that year, with FI/EN title and summary derived from the same dataset-diff computation the rate-change blog drafts use, the official source URL, and an audit record. Creation SHALL be fail-open: a failure SHALL NOT block or roll back the dataset confirmation. Re-confirming the same dataset version SHALL NOT duplicate the event.

#### Scenario: Confirmation creates the event

- **WHEN** a dataset version effective 1 January of a new year is confirmed
- **THEN** a CONFIRMED FI_EXCISE_CHANGE event for that date SHALL exist, linked to the official source, with an audit record

#### Scenario: Confirmation survives event failure

- **WHEN** the automatic event creation fails
- **THEN** the dataset confirmation SHALL still complete and the failure SHALL be logged

#### Scenario: Idempotent re-confirmation

- **WHEN** the same dataset version is confirmed again
- **THEN** no duplicate event SHALL be created

### Requirement: Candidate collection from source feeds

A scheduled watcher SHALL poll the verified source feeds, normalize items into calendar-event candidates (source, URL, title, published date), and store them as PENDING rows in a dedicated candidates table that is never served on any public endpoint. The watcher SHALL deduplicate by URL (an already-known URL SHALL never become a candidate again), SHALL bound each run (bounded item count, polite identification, collected failures), and SHALL fail open: a feed error SHALL skip that feed and leave the rest of the run intact.

#### Scenario: New item becomes a candidate

- **WHEN** the watcher observes an item whose URL is not yet known
- **THEN** a PENDING candidate SHALL be stored with its source, URL, title, and published date

#### Scenario: Known URL never re-suggested

- **WHEN** the watcher observes an item whose URL already exists as a candidate
- **THEN** no duplicate candidate SHALL be created

#### Scenario: Feed failure fails open

- **WHEN** one source feed errors during a run
- **THEN** the remaining feeds SHALL still be processed and the run SHALL complete

### Requirement: Operator review queue for candidates

The ops console SHALL list PENDING candidates (source, URL, title, detected date) behind the ops access guard, and the operator SHALL accept a candidate — creating the calendar event through the persistence-boundary validator, marking it ACCEPTED, and writing an audit record — or reject it (REJECTED, retained for dedup), also audited. Unauthenticated access SHALL be rejected, and no candidate SHALL appear on any public endpoint until accepted.

#### Scenario: Accept publishes the event

- **WHEN** an operator accepts a PENDING candidate with a valid event payload
- **THEN** the created event SHALL follow the calendar event contract (source URL, FI/EN text, CONFIRMED/EXPECTED rules) and SHALL be immediately visible through the public calendar API according to its status

#### Scenario: Reject is recorded

- **WHEN** an operator rejects a candidate
- **THEN** it SHALL be marked REJECTED, retained for URL dedup, never published, and the action SHALL appear in the audit trail

#### Scenario: Guard enforced

- **WHEN** an unauthenticated request touches candidate listing, acceptance, or rejection
- **THEN** the ops access guard SHALL reject it

### Requirement: Watcher operational safety

The watcher SHALL identify itself politely, bound its per-run work, and record its outcomes; a run SHALL complete even when individual feeds or items fail, with failures counted rather than raised. The cron schedule SHALL be documented alongside the existing UTC-only cron constraints.

#### Scenario: Bounded run

- **WHEN** a feed returns more items than the per-run bound
- **THEN** the watcher SHALL process only the bound and carry no overflow state that could surprise a later run

#### Scenario: Malformed item skipped

- **WHEN** a feed item cannot be normalized
- **THEN** it SHALL be counted as a failure and skipped without aborting the run

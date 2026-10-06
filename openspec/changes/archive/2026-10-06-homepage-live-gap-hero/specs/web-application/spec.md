# web-application Delta

## ADDED Requirements

### Requirement: Homepage live observed-difference section

The homepage SHALL render a server-side section presenting the day's
largest observed landed-cost gaps among products cheaper than their
Alko reference, sourced from the public top-N savings read. The
section SHALL display the snapshot as-of date beside the figures, and
each row SHALL link to that product's detail page as one whole-row
link. All copy SHALL state observed facts neutrally (observed
differences against the Alko reference), pass the content-policy lint
in both locales, and SHALL NOT contain advice, recommendation, or
promotional phrasing. When no snapshot rows exist, the section SHALL
render a designed pending state; when the server read fails or the
latest snapshot day is older than a fixed freshness cutoff, it SHALL
render a designed unavailable state — figures SHALL NEVER be guessed
or presented as current when the snapshot is not. The section
introduces no input surface: the hero search remains the homepage's
only input.

#### Scenario: Live figures with as-of provenance

- **WHEN** the homepage renders with an available snapshot within the freshness cutoff
- **THEN** the section shows up to five rows with product name, observed figures, gap, and the as-of date, each row linking to the product's detail page

#### Scenario: Pending state instead of figures

- **WHEN** no eligible snapshot rows exist
- **THEN** the section renders a designed pending state and renders no figures

#### Scenario: Unavailable state on failed or stale read

- **WHEN** the server read fails or the latest snapshot day is older than the freshness cutoff
- **THEN** the section renders a designed unavailable state instead of stale or absent-looking figures

#### Scenario: Neutral lint-clean copy

- **WHEN** the section's strings are linted in both locales
- **THEN** the content-policy lint passes with no promotional or advice violations

## MODIFIED Requirements

### Requirement: Homepage worked example

The homepage SHALL include a static, server-rendered worked-example
section positioned BELOW the live observed-difference section and
compacted into a small "how it works" step format, showing a
Finland-versus-cross-border cost breakdown with figures explicitly
labeled as an example. The section SHALL make no API call and SHALL
NOT present example figures as observed or live data.

#### Scenario: Example is labeled and static

- **WHEN** the homepage renders
- **THEN** the worked-example section appears in the server HTML with example-labeled figures and no data fetch

#### Scenario: Example is demoted below the live section

- **WHEN** the homepage renders
- **THEN** the worked-example section appears in the server HTML below the live observed-difference section in step form

# trip-feasibility-calculator Specification

## ADDED Requirements

### Requirement: Anonymous allowance fill

`POST /api/v1/trip/fill` SHALL be reachable without a session: the session-auth and entitlement guards no longer apply. The CALCULATOR rate limit, the version-aware idempotency caching, and the ferry-offer display-only neutrality contract SHALL remain unchanged.

#### Scenario: Anonymous visitor fills allowances

- **WHEN** a request without a session cookie posts a valid fill body
- **THEN** the endpoint returns the fill result and no authentication error occurs

#### Scenario: Admission controls still apply

- **WHEN** an anonymous client exceeds the CALCULATOR rate profile on the fill endpoint
- **THEN** the request is rejected with 429 and a `Retry-After` header

### Requirement: Benchmark pre-fill with consumer labels

The trip calculator SHALL pre-fill per-category €/l inputs from the category price benchmarks behind an explicit toggle: "Käytä keskihindoja" (benchmark defaults) vs "Syötä omat hinnat" (manual entry). Excise category labels SHALL render in consumer language through the message catalogs in both locales (e.g. `intermediate_products` as "Väkevöidyt viinit (vermutti, portviini)", `other_fermented` as "Lonkerot ja siiderit"); raw storage keys SHALL NOT be user-visible.

#### Scenario: Benchmark defaults pre-fill the form

- **WHEN** a visitor opens the trip calculator with benchmarks available
- **THEN** the €/l fields pre-fill from the category averages and the active "Käytä keskihintoja" state is visible

#### Scenario: Custom prices override

- **WHEN** the visitor switches to "Syötä omat hinnat"
- **THEN** the fields become editable from the current values and the calculation consumes the entered prices

#### Scenario: Storage keys never render

- **WHEN** a category label renders in either locale
- **THEN** the text comes from the message catalog and never the raw category key

### Requirement: Factual trip suggestion from savings snapshots

After a trip calculation the page SHALL render a compact factual suggestion drawn from the savings snapshots (e.g. "Viime kuussa Tallinnasta tilaajat säästivät keskimäärin 34% oluissa"), stating its as-of window, whenever snapshot data covers the destination country and period. The suggestion is display-only, never a calculation or ranking input, and renders nothing when no covering data exists.

#### Scenario: Snapshot data exists

- **WHEN** a trip result renders and the savings snapshots cover the destination country and period
- **THEN** the suggestion states the observed average saving percentage with its as-of window

#### Scenario: No covering data renders nothing

- **WHEN** no snapshot data covers the destination or period
- **THEN** the suggestion section is absent rather than showing a placeholder

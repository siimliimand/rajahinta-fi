# tax-change-calendar Specification

## Purpose
A recurring-rhythm public surface that shows when alcohol prices change and why, maintained as sourced data rather than annual rewriting, with an honest separation between confirmed changes and annual rhythm — giving users a recurring reason to return and giving the cross-border comparison a visible annual pulse.

## Requirements

### Requirement: Calendar events as closed-vocabulary sourced data

The system SHALL store price-change calendar events in a dedicated table where every event carries an event type from the closed set `FI_EXCISE_CHANGE | EE_EXCISE_CHANGE | ALKO_PRICE_LIST | TAX_TABLE_PUBLICATION | RATE_DECISION`, a status from the closed set `CONFIRMED | EXPECTED`, a mandatory official source URL, and title plus summary text in both Finnish and English. A CONFIRMED event SHALL carry an exact occurrence date. An EXPECTED event SHALL NOT carry an exact occurrence date and SHALL instead carry an expected window with at most month-or-quarter precision. An event type outside the closed set, a missing source URL, or a missing locale text SHALL be rejected at the persistence boundary.

#### Scenario: Unknown event type rejected

- **WHEN** an event is created with a type outside the closed set
- **THEN** the persistence boundary SHALL reject it with a contract-level error naming the valid types, never silently coercing it

#### Scenario: Source and locales mandatory

- **WHEN** an event is created without an official source URL or without both FI and EN text
- **THEN** the persistence boundary SHALL reject the event

#### Scenario: Expected event has no exact date

- **WHEN** an event with status EXPECTED is stored
- **THEN** it SHALL carry an expected window and no exact occurrence date

### Requirement: Honest separation of confirmed changes from annual rhythm

The calendar page and widget SHALL render CONFIRMED events with their exact date and official source link, and EXPECTED events as annual rhythm with the expected window — never as predictions. Every EXPECTED-event presentation SHALL carry a structural disclaimer stating the event is a recurring rhythm, not a forecast or an official announcement; the disclaimer wording SHALL be selected from a versioned FI/EN constant pair and SHALL NOT be composed at request time. The wording SHALL be free of forecast or political language.

#### Scenario: Confirmed event shows date and source

- **WHEN** a CONFIRMED event is rendered
- **THEN** it SHALL show its exact date and link its official source

#### Scenario: Expected event shows rhythm and disclaimer

- **WHEN** an EXPECTED event is rendered
- **THEN** it SHALL show its expected window, the structural rhythm disclaimer, and SHALL NOT show a fabricated exact date

### Requirement: Public deterministic calendar API

A public API SHALL return calendar events for a requested year, ordered deterministically (occurrence date, then event type, then id, with EXPECTED events ordered by their window within the same period), and SHALL return the next upcoming event after the server's current date, where a CONFIRMED day-precision event beats an EXPECTED window event at the same period. Both endpoints SHALL be age-gated and rate-limited, and SHALL use the unified error envelope. Repeated identical requests SHALL produce identical responses.

#### Scenario: Deterministic order

- **WHEN** the year listing is requested twice for the same year
- **THEN** the events and their order SHALL be identical

#### Scenario: Next-event selection

- **WHEN** the next-event endpoint is queried
- **THEN** it SHALL return the nearest upcoming event by period, preferring a CONFIRMED exact date over an EXPECTED window in the same period, and its status SHALL be included

#### Scenario: Age gate applies

- **WHEN** an unconfirmed client queries either endpoint
- **THEN** the response SHALL follow the site's existing age-gate contract

### Requirement: Calendar page

The site SHALL serve a calendar page at `/veromuutokset` with an English variant at `/tax-changes`, rendering the requested year's events grouped by month on a year timeline, each event card showing its title, summary, status badge, and official-source link, alongside editorial context copy explaining the annual rhythm. The page SHALL cross-link to the what-if simulator and to published rate-change blog posts. The page SHALL be age-gated per site convention and included in the sitemap.

#### Scenario: Timeline groups by month

- **WHEN** the page renders a year with events
- **THEN** events SHALL appear grouped by their month (or expected window) in deterministic order

#### Scenario: Locale routing

- **WHEN** a user visits `/tax-changes` under the English locale path or `/veromuutokset` under the Finnish default
- **THEN** the page renders in the requested locale with no duplicate-content penalty between variants

### Requirement: Homepage next-change widget

The homepage SHALL render a next-price-change widget showing the next upcoming calendar event's title, its days-until (or its window label when the event is EXPECTED), and a link to the calendar page. The widget SHALL degrade gracefully when the next event is EXPECTED and SHALL NOT invent a countdown for a window event.

#### Scenario: Confirmed next event counts down

- **WHEN** the next event is CONFIRMED with a future exact date
- **THEN** the widget SHALL show the event title and the number of days until that date, linking to the calendar page

#### Scenario: Expected next event shows window label

- **WHEN** the next event is EXPECTED
- **THEN** the widget SHALL show the window label with the rhythm disclaimer and no day countdown

### Requirement: Audited ops maintenance path

An operator SHALL be able to list, create, and update calendar events through the ops console behind the existing ops access guard, and every create or update SHALL be recorded in the audit trail, so that a new year's events are added without a code change. Public endpoints SHALL serve only events; deletion SHALL NOT be part of this path.

#### Scenario: Operator adds a 2027 event

- **WHEN** an operator creates a 2027 rate-decision event through the ops console
- **THEN** the event SHALL become available to the public API according to its status and the action SHALL appear in the audit trail

#### Scenario: Ops access enforced

- **WHEN** an unauthenticated request attempts the calendar-events ops operations
- **THEN** it SHALL be rejected by the ops access guard

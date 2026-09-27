# web-application Specification

## ADDED Requirements

### Requirement: Functional homepage hero search

The homepage hero SHALL render a real search form: an `<input type="search">` inside a `<form>` whose submission navigates to `/calculator?q={term}`. The calculator SHALL read the `q` query parameter and pre-fill (and run) its product search with that term. A purely decorative element that imitates an input SHALL NOT be used.

#### Scenario: Submitting the hero search

- **WHEN** a visitor types "koskenkorva" into the hero search and submits
- **THEN** the browser navigates to `/calculator?q=koskenkorva` and the calculator shows search results for that term without retyping

#### Scenario: Empty submission stays on the calculator

- **WHEN** a visitor submits the hero search with an empty query
- **THEN** the browser navigates to the calculator page without a `q` value and no failed search state appears

### Requirement: Human loading, empty, and error states

Every page that fetches data SHALL render a visible loading state (skeleton or "Lasketaan…" copy, never a blank screen), an empty state that suggests next steps when a search returns no results (broader-search hint and category links), and a human error message with a retry action in place of raw HTTP error codes. A rate-limit (429) response SHALL render as the friendly "Hetkinen — lasketaan vielä edellistä" message, not a generic failure.

#### Scenario: Empty search suggests alternatives

- **WHEN** a catalog or calculator search returns no rows
- **THEN** the page shows the localized not-found message naming the query together with a broader-search suggestion and category browsing links

#### Scenario: Server error shows a retry

- **WHEN** a data fetch fails with a 5xx response
- **THEN** the page renders "Jokin meni pieleen — yritä hetken kuluttua uudelleen" with a retry button and no raw status code

### Requirement: Mobile-first interaction standards

Interactive controls SHALL meet a ≥44 px effective touch-target size on small viewports (category pills, quantity controls, sort and filter controls). Calculation results SHALL be readable without horizontal scrolling, and the product comparison table SHALL collapse to a card layout below the small-screen breakpoint.

#### Scenario: Category pills are thumb-sized

- **WHEN** the products catalog renders on a 375 px viewport
- **THEN** each category pill and pagination control presents a touch target of at least 44 px in both dimensions

#### Scenario: Compare collapses to cards

- **WHEN** the comparison view renders below the small-screen breakpoint
- **THEN** products render as stacked cards instead of a horizontally scrolling table

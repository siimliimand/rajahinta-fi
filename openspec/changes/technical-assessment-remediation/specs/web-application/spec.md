# web-application Specification Delta

## ADDED Requirements

### Requirement: Finnish default locale with English secondary

The frontend SHALL use a message-catalog localization setup (next-intl or equivalent) with Finnish as the default locale and English secondary. User-facing copy SHALL live in message catalogs, and the content-policy lint SHALL cover both locales. The rendered `lang` attribute SHALL match the active locale.

#### Scenario: Default renders Finnish

- **WHEN** a user visits without a locale preference
- **THEN** the UI SHALL render in Finnish with `lang="fi"`

#### Scenario: Lint polices both catalogs

- **WHEN** either the Finnish or English catalog introduces disallowed vocabulary
- **THEN** the content-policy lint SHALL fail

### Requirement: Shared navigation

The application SHALL provide a layout-level header with the five destinations (calculator, compare, basket, account, ranking) on every page, and a footer carrying the disclaimer and methodology link. Per-page hand-rolled back-links SHALL be removed.

#### Scenario: Navigation on every page

- **WHEN** a user lands on any route
- **THEN** the header SHALL offer the five destinations without returning home first

### Requirement: Debounced search input

Search input SHALL debounce submissions by approximately 300 ms so rapid keystrokes do not queue requests.

#### Scenario: Rapid typing sends one request

- **WHEN** a user types quickly and pauses
- **THEN** one debounced search request SHALL be issued for the settled query

### Requirement: Feature flags inline in initial HTML

Feature-flag states SHALL be inlined in the initial HTML payload so gated UI renders with first paint and does not appear late after a client-side fetch.

#### Scenario: No gated-UI flash

- **WHEN** a page with flag-gated UI loads
- **THEN** the gated UI's visibility SHALL match its flag state in the first render, with no late appearance

### Requirement: SEO surface

The frontend SHALL provide a sitemap, robots rules, and per-product pages with metadata drawn from product data.

#### Scenario: Product page metadata

- **WHEN** a crawler fetches a product page
- **THEN** it SHALL receive title and description metadata specific to that product

# web-application Specification

## ADDED Requirements

### Requirement: Legacy path redirect map

The middleware layer SHALL maintain an explicit redirect map of exact legacy paths from the previous site generation to current canonical localized paths, issuing permanent (301) redirects before locale negotiation. Map entries SHALL be evidence-backed: a path enters the map only with recorded search-console impressions or an equivalent operator decision recorded in the map's documentation. Legacy paths absent from the map SHALL fall through to the localized not-found page, which SHALL carry navigation affordances (site search entry, calculator, and catalog links). The map SHALL be a plain data module so entries are added without route changes.

#### Scenario: Mapped legacy path redirects permanently

- **WHEN** a request arrives for a path in the map
- **THEN** the middleware answers 301 with the mapped canonical target before locale negotiation

#### Scenario: Unmapped legacy path lands on the localized 404

- **WHEN** a request arrives for a legacy path not in the map
- **THEN** the localized not-found page renders with search, calculator, and catalog affordances

#### Scenario: API and asset exclusions unaffected

- **WHEN** a request matches the middleware's existing exclusions (API, Next internals, static files, localized product detail)
- **THEN** the redirect map is not consulted

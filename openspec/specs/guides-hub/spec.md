# guides-hub Specification

## Purpose
TBD - created by archiving change insight-surfaces. Update Purpose after archive.
## Requirements
### Requirement: Evergreen guides on the blog publication pipeline

The system SHALL support evergreen guide posts (kind GUIDE) alongside rate-change posts (kind RATE_CHANGE) in the same `blogPosts` store, distinguished by a kind discriminator defaulting to RATE_CHANGE. Operators SHALL create and edit guide drafts through ops console actions behind the ops-access guard, and guide publication SHALL follow the same human DRAFT-to-PUBLISHED path, with the action appended to the audit trail. Guides SHALL carry no rate-dataset-version provenance because none applies to them.

#### Scenario: Operator creates a guide draft

- **WHEN** an operator creates a guide draft with title, slug, locale, and body through the ops console
- **THEN** a DRAFT row with kind GUIDE SHALL exist, invisible on all public surfaces

#### Scenario: Guide publishes through the human path

- **WHEN** an operator publishes a GUIDE-kind draft
- **THEN** it SHALL appear under `/guides` for its locale and the action SHALL be audited

#### Scenario: Kinds never mix in listings

- **WHEN** the blog index or the guides index is queried
- **THEN** the blog index SHALL return PUBLISHED RATE_CHANGE posts only and the guides index SHALL return PUBLISHED GUIDE posts only

### Requirement: Guide pages are public, localized, and lint-covered

Published guides SHALL render at `/guides/[slug]` per locale with the same rendering treatment as blog posts, and SHALL be included in the sitemap. Guide bodies SHALL pass the content-policy lint before publication, in both locales. Guide pages SHALL cross-link to the allowance explorer and the trip calculator where topically relevant.

#### Scenario: Localized rendering

- **WHEN** a published guide is requested under its locale path
- **THEN** the page SHALL render the guide body with the site's standard chrome, disclaimers where applicable, and no draft content

#### Scenario: Lint coverage

- **WHEN** a guide body contains phrasing the content policy forbids
- **THEN** publication SHALL be blocked until the body passes the lint

#### Scenario: Sitemap inclusion

- **WHEN** the sitemap is generated
- **THEN** published guide pages SHALL be listed alongside blog posts

### Requirement: FAQ entries

The guides platform SHALL carry FAQ entries answering the standing visitor questions (landed cost meaning, price freshness, data sources, tax inclusion, legal bringing limits, accuracy, update cadence, account purpose). Entries SHALL be published through the existing ops guides flow in both locales, PUBLISHED status only, and linked from the homepage FAQ section.

#### Scenario: FAQ entries publish through the existing flow

- **WHEN** an operator publishes an FAQ entry via the ops guides console
- **THEN** the entry appears in the guides hub for its locale and becomes linkable from the homepage FAQ section

#### Scenario: Homepage links only published entries

- **WHEN** the homepage FAQ section renders
- **THEN** it lists only PUBLISHED FAQ entries and renders nothing when none exist


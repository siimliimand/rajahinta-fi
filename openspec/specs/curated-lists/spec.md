# curated-lists Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.
## Requirements
### Requirement: Editorial list serving

The system SHALL serve public curated lists by slug (starting with "Alkon hylkäämät"), returning only published entries, each with its rationale, evidence links, and outbound link. Lists SHALL be gated behind `enable_curated_lists` and SHALL carry SEO metadata and sitemap entries.

#### Scenario: Published list served

- **WHEN** a visitor requests a published list slug
- **THEN** the page SHALL render the curation criteria, every published entry with its rationale, and tracked outbound links

#### Scenario: Draft entries hidden

- **WHEN** an entry is in draft state
- **THEN** it SHALL NOT appear on the public list or in the API response

### Requirement: Curation criteria documented and shown

Each list SHALL have documented curation criteria (for example rating sources or awards), stored with the list and rendered on the public page, so entries are not arbitrary.

#### Scenario: Criteria rendered

- **WHEN** a list page is viewed
- **THEN** the criteria that qualify entries for the list SHALL be visible on the page

### Requirement: Operator-managed updates without deploys

List entries SHALL be created, updated, and unpublished through the audited operator console. Content changes SHALL NOT require code changes or deploys, and every change SHALL be recorded in the audit trail.

#### Scenario: Entry published from console

- **WHEN** an operator publishes a new entry
- **THEN** the public list SHALL reflect it on the next read and the audit trail SHALL record the actor and action


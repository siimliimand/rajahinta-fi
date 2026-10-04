# group-order-ledger Specification

## Purpose
TBD - created by archiving change product-roadmap-phases-1-4. Update Purpose after archive.

## Requirements

### Requirement: Shared session with shareable token

An authenticated user SHALL create a group order session that participants join through a shareable token link, each participant adding items under a self-chosen nickname. The token SHALL grant access only to its session and SHALL expire. The session SHALL store no personal data beyond participant nicknames and no account data for non-owning participants.

#### Scenario: Participant joins by link

- **WHEN** a person opens a valid share link
- **THEN** they SHALL be able to add items to the session under a nickname without creating an account

#### Scenario: Expired token rejected

- **WHEN** a share link past its expiry is opened
- **THEN** the session SHALL NOT be accessible through it

### Requirement: Proportional allocation with deterministic remainders

The ledger SHALL split shared costs (shipping, packaging duty) across participants proportionally to each participant's item value share, with a documented deterministic remainder rule, and SHALL compute the minimal set of who-owes-whom transfers that settles all balances. All arithmetic SHALL be pure and reproducible.

#### Scenario: Proportional split

- **WHEN** shared costs exist and participants hold unequal item values
- **THEN** each participant's share of shared costs SHALL equal their proportional value share, with remainders assigned by the documented rule

#### Scenario: Minimal transfers

- **WHEN** balances are computed
- **THEN** the output SHALL contain the smallest number of transfers that settle all balances, and the same input SHALL always yield the same transfers

### Requirement: Accounting-only boundary

The system SHALL NOT process, broker, or facilitate payments: no payment links, no payment-instrument fields, no transaction execution. The API SHALL reject payloads containing payment-instrument data at the DTO validation layer, and the UI SHALL state that settlement happens outside Rajahinta through users' own methods.

#### Scenario: Payment payload rejected

- **WHEN** a client submits an item or session update containing payment-instrument fields
- **THEN** the API SHALL reject it with a validation error naming the disallowed field

#### Scenario: Boundary stated

- **WHEN** the group order page is viewed
- **THEN** it SHALL display that Rajahinta does not process or manage payments

### Requirement: Group-order discoverability

The group-order creation page SHALL be a discoverable surface: linked from the site footer in every locale, listed in the sitemap's static paths (`/group-order`), and crawlable by robots — the blanket `/group-order` robots disallow SHALL be narrowed to the token subpaths `/group-order/*` and `/en/group-order/*`, so token-scoped session pages remain non-indexable while the creation page becomes crawlable. The header navigation set SHALL remain unchanged: the group-order surface is deliberately a footer-class surface, not a header destination.

#### Scenario: Create page is linked and crawlable

- **WHEN** the site footer renders in any locale or the sitemap is fetched
- **THEN** the group-order creation page appears as a link, and robots.txt does not exclude the creation page path

#### Scenario: Token sessions stay non-indexable

- **WHEN** robots.txt is fetched
- **THEN** the disallow rules cover `/group-order/*` and `/en/group-order/*` while the creation page `/group-order` itself is not disallowed

#### Scenario: Header navigation stays closed

- **WHEN** the site header renders its desktop or mobile navigation set
- **THEN** no group-order entry appears and the curated navigation sets are unchanged

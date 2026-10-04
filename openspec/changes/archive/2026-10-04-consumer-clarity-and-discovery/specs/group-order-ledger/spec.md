# group-order-ledger Delta

## REMOVED Requirements

### Requirement: Feature gating

**Reason**: The flag and launch-gate systems were removed from the repository on 2026-09-07 (owner decision; project guardrail "No feature flags" — every feature ships unconditionally, rollback is `wrangler rollback`). The group-order routes register unconditionally and the UI serves without a gate, so this requirement documents a mechanism the repo can no longer express. The feature's own boundary requirement (accounting-only, no payment processing) remains the protection the gate once framed.

**Consequence**: Group order endpoints and UI serve unconditionally like every other shipped surface; the `feature-disabled error` scenario disappears.

## ADDED Requirements

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

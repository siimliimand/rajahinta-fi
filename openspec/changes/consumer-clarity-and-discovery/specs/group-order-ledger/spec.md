# group-order-ledger Delta

## REMOVED Requirements

### Requirement: Feature gating

**Reason**: The flag and launch-gate systems were removed from the repository on 2026-09-07 (owner decision; project guardrail "No feature flags" — every feature ships unconditionally, rollback is `wrangler rollback`). The group-order routes register unconditionally and the UI serves without a gate, so this requirement documents a mechanism the repo can no longer express. The feature's own boundary requirement (accounting-only, no payment processing) remains the protection the gate once framed.

**Consequence**: Group order endpoints and UI serve unconditionally like every other shipped surface; the `feature-disabled error` scenario disappears.

## ADDED Requirements

### Requirement: Group-order discoverability

The group-order creation page SHALL be a discoverable surface: linked from the site footer in every locale, listed in the sitemap as a static destination, and crawlable by robots. Token-scoped session pages (`/group-order/{token}`) SHALL remain non-indexable — the robots exclusion SHALL cover token subpaths without excluding the creation page. The header navigation set SHALL remain unchanged.

#### Scenario: Create page is linked and crawlable

- **WHEN** the site footer renders in any locale or the sitemap is fetched
- **THEN** the group-order creation page appears as a link, and robots.txt does not exclude the creation page path

#### Scenario: Token sessions stay non-indexable

- **WHEN** robots.txt is fetched
- **THEN** token subpaths under `/group-order/` are disallowed while the creation page is not

# mvp-testing Specification Delta

## ADDED Requirements

### Requirement: Currency correctness coverage

Tests SHALL cover FX conversion provenance, rejection of unconvertible offers, a mixed-currency golden case, and cache invalidation on FX dataset version change, using real engines per the no-mocks convention.

#### Scenario: Mixed-currency golden case

- **WHEN** the golden dataset includes SEK and EUR offers
- **THEN** the expected totals SHALL be EUR-converted and reproducible from recorded provenance

### Requirement: Session security coverage

Tests SHALL prove token issuance and rotation, denial of forged or guessed tokens, rejection of the legacy `x-user-id` header, and denial of cross-account access.

#### Scenario: Impersonation attempt fails

- **WHEN** a test presents another session's identifier via the legacy header
- **THEN** the API SHALL deny access

### Requirement: Browser-level end-to-end tests

A Playwright suite SHALL cover the user journeys the HTTP-level suite cannot: age gate, calculator flow, compare sorting, and account export.

#### Scenario: Browser journey passes

- **WHEN** the Playwright suite runs in CI
- **THEN** the four journeys SHALL execute against the composed stack and pass

### Requirement: Durability and scaling coverage

Integration tests SHALL prove rate limits are shared across two application instances and that audit events and click counters survive process restarts.

#### Scenario: Two-instance limit

- **WHEN** two API instances receive traffic from one client up to the limit
- **THEN** the shared counter SHALL throttle at the configured threshold, not twice it

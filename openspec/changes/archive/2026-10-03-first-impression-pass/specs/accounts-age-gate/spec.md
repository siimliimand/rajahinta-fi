# Spec Delta: accounts-age-gate

## MODIFIED Requirements

### Requirement: Gate presentation

The age gate SHALL be a presentation-layer overlay, not a content replacement. The server SHALL NOT read the `age_confirmed` cookie during rendering; the visitor's initial gate state SHALL be established client-side before first paint by an inline script that reads the cookie — the cookie remains the single confirmation state, and the inline script is a reader of it, not a second store. Page content SHALL always be present in the server HTML. Visitors without a confirmed cookie SHALL see the confirmation modal as a fixed overlay above the content; interaction with the page remains blocked until confirmation. Because rendering does not depend on request cookies, pages remain eligible for incremental static regeneration and CDN caching, and a cached response SHALL present the correct gate state for each visitor once the pre-paint script runs, with no gate flash for confirmed visitors. The API-side gate SHALL be unchanged: gated endpoints SHALL keep returning 403 `AGE_GATE_REQUIRED` without a valid confirmation token, and server-side data fetches SHALL keep presenting the server confirmation token.

#### Scenario: Cookie-less fetch still receives content

- **WHEN** a client requests any public page without an `age_confirmed` cookie
- **THEN** the server HTML contains the page's content (header, footer, and the page body), and the confirmation modal is present as an overlay

#### Scenario: Cached HTML presents the correct gate state

- **WHEN** a visitor receives a CDN-cached response, with or without a confirmed cookie
- **THEN** the pre-paint script applies the visitor's own gate state before first paint, the overlay blocks unconfirmed visitors, and confirmed visitors see no gate flash and no reload

#### Scenario: Unconfirmed browser sees the overlay

- **WHEN** a visitor without a confirmed cookie loads a page
- **THEN** the modal renders above the content, focus moves into it, and page interaction is blocked until confirmation

#### Scenario: Confirm stores the decision

- **WHEN** the visitor confirms
- **THEN** the `age_confirmed` cookie is stored with the 90-day TTL, the overlay closes, and the content beneath is usable without a reload

#### Scenario: Decline leaves via the neutral page

- **WHEN** the visitor declines
- **THEN** the cookie is cleared and the visitor navigates to `/age-gate/declined`, which remains reachable without re-asking the question

#### Scenario: Expired cookie recovery

- **WHEN** a gated API request returns 403 `AGE_GATE_REQUIRED` after hydration
- **THEN** the overlay re-opens in place through the existing recovery event

#### Scenario: Gate copy states the storage plainly

- **WHEN** the gate copy renders in either locale
- **THEN** it describes browser local storage in standard terms and states that no personal data is collected, with no "local flag" phrasing

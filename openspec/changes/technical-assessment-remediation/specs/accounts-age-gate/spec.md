# accounts-age-gate Specification Delta

## ADDED Requirements

### Requirement: Age gate renders no restricted content server-side

During SSR and before hydration, the age gate wrapper SHALL render a placeholder, not the gated children. Restricted content SHALL NOT be present in server-rendered DOM.

#### Scenario: SSR shows placeholder

- **WHEN** a gated page is server-rendered or fetched without JavaScript
- **THEN** the response HTML SHALL contain the age-gate placeholder and not the restricted content

### Requirement: Neutral decline destination

Declining the age gate SHALL redirect to a neutral in-house page, not an external site, so the redirect neither looks broken nor leaks a referrer.

#### Scenario: Decline stays in-house

- **WHEN** a user answers "No" at the age gate
- **THEN** the browser SHALL land on an in-house information page

### Requirement: Phase 1 confirmation is documented self-attestation

The system SHALL document explicitly that the Phase 1 confirmation provider proves only that a confirmation token was sent, and the provider interface SHALL remain in place for planned stronger verification.

#### Scenario: Documentation states the limit

- **WHEN** the age-gate behaviour is described in documentation or API metadata
- **THEN** the self-attestation scope of Phase 1 confirmation SHALL be stated

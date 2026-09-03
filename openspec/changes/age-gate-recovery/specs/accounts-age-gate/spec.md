# accounts-age-gate Specification Delta

## ADDED Requirements

### Requirement: Single client confirmation state

The client age gate SHALL derive its confirmed state solely from the `age_confirmed` cookie with a bounded lifetime. The application SHALL NOT keep a second client-side store that can disagree with the cookie about confirmation state. Stale confirmation state left by earlier versions SHALL be ignored and cleaned up.

#### Scenario: Expired confirmation re-prompts

- **WHEN** a visitor whose confirmation cookie has expired opens a gated view
- **THEN** the age-gate prompt SHALL be presented again

#### Scenario: Stale legacy state is ignored

- **WHEN** a browser carries a confirmation flag from an earlier version that used a secondary store, but no confirmation cookie
- **THEN** the gate SHALL treat the visitor as unconfirmed, present the prompt, and remove the stale flag

#### Scenario: Deny clears the single state

- **WHEN** a user declines the age gate
- **THEN** the confirmation cookie SHALL be cleared and the user SHALL land on the in-house declined page

### Requirement: In-place recovery from gate rejection

WHEN a client-side request to a gated endpoint is rejected with the age-gate rejection code, the application SHALL present the age-gate prompt in place, with localized copy, instead of ending in an unrecoverable error message. After confirming, the user SHALL be able to retry the action without a full page reload. The raw backend error message SHALL NOT be the terminal user-facing state for this rejection.

#### Scenario: Gated call rejected mid-session

- **WHEN** a gated API call fails with the age-gate rejection code while the user is working in the app
- **THEN** the age-gate prompt SHALL open in place and the confirmation SHALL be recorded client-side so a retry succeeds

#### Scenario: Localized recovery copy

- **WHEN** the age-gate rejection is surfaced in an error state
- **THEN** the title and description SHALL be localized (Finnish and English), not the backend's raw message string

## MODIFIED Requirements

### Requirement: Server-side age gate

The age gate SHALL be enforced server-side on alcohol-content endpoints, not only as a frontend component. The gate remains a simple confirmation, not identity verification. Rejections SHALL carry a stable machine-readable code in the error body, identical across API implementations, so clients can react to the rejection without parsing human-readable messages.

#### Scenario: Confirmation required

- **WHEN** a request reaches an alcohol-content endpoint without a valid confirmation token
- **THEN** the endpoint SHALL reject it with a clear age-confirmation requirement and a machine-readable rejection code

#### Scenario: Machine-readable rejection code

- **WHEN** the age-gate rejection is produced by either API implementation
- **THEN** the response body SHALL include the same stable rejection code in addition to the human-readable message

#### Scenario: Public content exempt

- **WHEN** a request targets landing or comparison content
- **THEN** it SHALL remain reachable without a confirmation token

#### Scenario: No identity collection

- **WHEN** the age gate is used
- **THEN** no identity document or date-of-birth SHALL be collected

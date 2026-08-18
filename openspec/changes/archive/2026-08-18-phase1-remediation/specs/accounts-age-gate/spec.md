## ADDED Requirements

### Requirement: Server-side age gate

The age gate SHALL be enforced server-side on alcohol-content endpoints, not only as a frontend component. The gate remains a simple confirmation, not identity verification.

#### Scenario: Confirmation required

- **WHEN** a request reaches an alcohol-content endpoint without a valid confirmation token
- **THEN** the endpoint SHALL reject it with a clear age-confirmation requirement

#### Scenario: Public content exempt

- **WHEN** a request targets landing or comparison content
- **THEN** it SHALL remain reachable without a confirmation token

#### Scenario: No identity collection

- **WHEN** the age gate is used
- **THEN** no identity document or date-of-birth SHALL be collected

### Requirement: Account endpoints exposed

The minimal account system SHALL expose saved baskets, calculation history, and subscription status through the API, in addition to data export.

#### Scenario: Baskets

- **WHEN** an account holds saved baskets
- **THEN** the API SHALL list, save, and delete them

#### Scenario: History

- **WHEN** an account has calculation history
- **THEN** the API SHALL return it

#### Scenario: Subscription status

- **WHEN** a user queries their subscription
- **THEN** the API SHALL return the current tier and status

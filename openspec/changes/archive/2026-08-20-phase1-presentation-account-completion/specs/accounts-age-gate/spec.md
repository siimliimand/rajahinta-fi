## ADDED Requirements

### Requirement: Functional anonymous session

The minimal account system SHALL be reachable end-to-end from the web application. A user SHALL be able to establish an anonymous session without providing an email, date-of-birth, or identity document.

#### Scenario: Establish session

- **WHEN** a user chooses to create an account or sign in
- **THEN** the system SHALL generate an anonymous session identity and persist it client-side, without collecting personal data

#### Scenario: Session propagates to API

- **WHEN** the web app makes an account-scoped request
- **THEN** it SHALL send the session identity so the request is attributed to the account

### Requirement: Calculation history recording

When a signed-in user runs a landed-cost calculation, the calculation record ID SHALL be appended to the user's calculation history.

#### Scenario: History recorded

- **WHEN** a user with an active session runs a calculation
- **THEN** the resulting record ID SHALL be recorded in the user's calculation history

#### Scenario: History retrievable

- **WHEN** the user views their account
- **THEN** their calculation history SHALL be displayed

### Requirement: Retention scheduled job

The retention policies (account deletion, account anonymization, calculation-history purge, analytics anonymization) SHALL be enforced by an automated recurring job, not only by manually invocable service methods.

#### Scenario: Retention expiry

- **WHEN** account data reaches its retention limit
- **THEN** an automated job SHALL delete or anonymize it without manual intervention

### Requirement: Data export surfaced

The data-export capability SHALL be reachable from the account UI, returning the user's own data in a portable form.

#### Scenario: Data export request

- **WHEN** a user requests their data from the account page
- **THEN** the system SHALL return their account data and calculation history as a downloadable JSON payload

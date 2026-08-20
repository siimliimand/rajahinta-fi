## ADDED Requirements

### Requirement: Click analytics endpoint

The API SHALL expose an endpoint to record a click-through on an outbound merchant link. The endpoint SHALL record counts only and SHALL NOT accept or store any purchase or commission data.

#### Scenario: Click recorded

- **WHEN** a client reports a merchant-link click
- **THEN** the endpoint SHALL increment a click count for that merchant/link

#### Scenario: No commission data

- **WHEN** a client reports a click
- **THEN** no affiliate, commission, or purchase-tracking payload SHALL be accepted or stored

### Requirement: Calculation history endpoint

The API SHALL expose an endpoint to append a calculation record ID to a user's calculation history.

#### Scenario: History appended

- **WHEN** a client posts a calculation record ID for a valid user
- **THEN** the record ID SHALL be appended to that user's history and returned

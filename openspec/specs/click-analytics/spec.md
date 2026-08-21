# click-analytics Specification

## Purpose

Plain outbound merchant link redirect endpoint that records basic click-through counts without any purchase tracking, commission calculation, or affiliate infrastructure. Enforces the business plan's "no purchase tracking at launch" and "no affiliate incentives at launch" policies.

## Requirements

### Requirement: Redirect endpoint

The system SHALL expose a `GET /api/v1/outbound/:offerId` endpoint that accepts a retail offer ID, records the click as a log event, and issues a 302 redirect to the merchant's product URL.

#### Scenario: Successful click-through

- **WHEN** a user requests `GET /api/v1/outbound/42`
- **THEN** the system SHALL log a `[CLICK]` event with offer ID, merchant ID, and timestamp, and SHALL respond with a 302 redirect to the merchant URL

#### Scenario: Unknown offer

- **WHEN** a user requests `GET /api/v1/outbound/99999` for an offer that does not exist
- **THEN** the system SHALL respond with 404 and SHALL NOT redirect

### Requirement: No purchase or commission tracking

The click analytics service SHALL NOT collect, store, or compute any purchase data, commission data, affiliate IDs, or conversion tracking. The only data recorded SHALL be offer ID, merchant ID, and timestamp.

#### Scenario: No purchase fields in click log

- **WHEN** a click is recorded
- **THEN** the log entry SHALL NOT contain any purchase amount, commission rate, affiliate identifier, or conversion event

#### Scenario: Click counting only

- **WHEN** click statistics are queried
- **THEN** the response SHALL contain only click counts per merchant or offer, with no revenue or conversion metrics

### Requirement: Rate limiting on redirect endpoint

The redirect endpoint SHALL be rate-limited to prevent click fraud and abuse.

#### Scenario: Excessive clicks

- **WHEN** a client exceeds the rate limit for the redirect endpoint
- **THEN** the system SHALL respond with 429 and SHALL NOT redirect

### Requirement: Security attributes on redirect links

All outbound merchant links rendered in the frontend SHALL include `rel="nofollow noopener"` and `target="_blank"` attributes.

#### Scenario: Link rendered with security attributes

- **WHEN** a merchant link is rendered on any page
- **THEN** the anchor element SHALL include `rel="nofollow noopener"` and `target="_blank"`
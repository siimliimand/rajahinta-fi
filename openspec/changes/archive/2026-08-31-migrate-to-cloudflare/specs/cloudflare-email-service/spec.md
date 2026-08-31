# cloudflare-email-service Specification

## Purpose

Transactional and operational email for rajahinta.fi, sent exclusively through Cloudflare Email Service from a dedicated email Worker. This capability delivers the sending platform and its first consumer (operational freshness alerts); user-facing transactional email features (verification mail, digests) are future changes that will build on this contract.

## Requirements

### Requirement: Sending through the Cloudflare Email Service binding

All outbound email SHALL be sent by the email Worker (`apps/email-worker`) using the Cloudflare Email Service `send_email` binding, with sending domain verification (SPF/DKIM) managed through Cloudflare. No other component SHALL send email directly; other Workers call the email Worker's HTTP contract.

#### Scenario: Single sender in the system

- **WHEN** any component needs to send email
- **THEN** it calls the email Worker's send contract rather than an external SMTP or API provider

### Requirement: Token-authenticated internal send contract

The email Worker SHALL expose `POST /internal/email/send` accepting a structured message (recipient, subject, text and/or HTML body, reply-to) and SHALL reject requests lacking the configured shared-secret header. The endpoint SHALL validate the recipient address syntactically and SHALL return a deterministic error envelope on failure.

#### Scenario: Unauthorized send rejected

- **WHEN** a send request arrives without the shared-secret header
- **THEN** it is rejected with an authentication error and no email is sent

#### Scenario: Valid send accepted

- **WHEN** a valid, authenticated message is submitted
- **THEN** the Worker dispatches it via the `send_email` binding and returns the delivery outcome

### Requirement: Operational alerts delivered via email

The freshness alerting Cron handler SHALL deliver operator alerts through this send contract, using a structured plain-text template that identifies the violated invariant, its measured value, and its threshold.

#### Scenario: Alert email content

- **WHEN** a freshness invariant is violated
- **THEN** the operator receives an email naming the invariant, the measured value, and the threshold

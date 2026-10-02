# Spec Delta: contact-intake

## Purpose

Gives merchants and visitors a real, honest channel to the operator — store-listing inquiries, error reports, and general messages — without inventing addresses, promising response times, or collecting more personal data than the message itself requires.

## ADDED Requirements

### Requirement: Honest contact channel

The contact page SHALL offer a message form as the site's contact channel, presented in honest terms: messages are read by the operator, no response time is promised, and a reply is possible only when the sender provides a reply email. The page SHALL NOT invent an email address, a response-time promise, or a legal-review claim. The form SHALL work as a plain HTML POST without client-side JavaScript.

#### Scenario: Form posts without JavaScript

- **WHEN** a visitor submits the contact form with client-side JavaScript disabled
- **THEN** the browser performs a native POST and receives a rendered acknowledgement or error state

#### Scenario: Copy states the honest terms

- **WHEN** the contact page renders in either locale
- **THEN** it names what happens to the message (read by the operator), states that no response is guaranteed, and explains that a reply requires a reply email — with no invented address or promise

### Requirement: Rate-limited intake endpoint

The worker SHALL expose `POST /api/v1/contact` accepting form-encoded and JSON bodies with: a required bounded message field, a bounded topic from a fixed enum (product error, store inquiry, other), and an optional syntactically validated reply email. The endpoint SHALL include a honeypot field whose non-empty submissions are discarded silently, SHALL cap request size, and SHALL rate-limit per source. Success SHALL return a uniform acknowledgement; rejection states SHALL be honest and machine-readable.

#### Scenario: Honeypot submissions are discarded

- **WHEN** a submission arrives with the honeypot field non-empty
- **THEN** the endpoint SHALL return the uniform acknowledgement without storing the message

#### Scenario: Rate limit is honest

- **WHEN** a source exceeds the intake rate limit
- **THEN** the endpoint responds 429 with the unified error envelope and no message is stored

#### Scenario: Oversize message is rejected

- **WHEN** a submission exceeds the declared message or field-size caps
- **THEN** the endpoint rejects it with a clear validation error and stores nothing

### Requirement: Minimal personal data with bounded retention

Stored contact messages SHALL contain only: the message content, the topic, the optional reply email, the UI locale, the submission timestamp, and a hashed (never raw) source IP for abuse forensics. Records SHALL be deleted after 90 days. Messages SHALL NOT be linked to accounts or used for profiling.

#### Scenario: IP stored only hashed

- **WHEN** a stored contact message row is inspected
- **THEN** it contains a salted hash of the source IP, never the raw address

#### Scenario: Retention is bounded

- **WHEN** a contact message is older than 90 days
- **THEN** it SHALL be deleted by the retention job

### Requirement: Operator read path

Messages SHALL be readable by the operator through the documented wrangler SQL query in the change runbook; this capability SHALL NOT require an admin UI. Stored messages SHALL persist until the operator acts on them or retention expires — nothing SHALL silently drop an unread message.

#### Scenario: Operator queries the inbox via documented SQL

- **WHEN** the operator follows the runbook query against production D1
- **THEN** stored messages are listed newest-first with topic, locale, timestamp, and reply email when present

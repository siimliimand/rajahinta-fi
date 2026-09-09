# content-publication Specification

## Purpose

Rate changes are worth announcing, and a human decides what is published. When an operator confirms a new official rate dataset version, draft blog posts are created automatically in Finnish and English — what changed, the effective date, the estimated impact on a typical basket — and stay drafts until an operator publishes them. Alongside the blog runs a double opt-in newsletter whose consent is stored separately from price-alert consent, delivered through the email worker with an intent log so a retried send cannot duplicate an email.
## Requirements
### Requirement: Draft creation at the manual rate gate

When an operator confirms a new official rate dataset version, the system SHALL create draft blog posts (Finnish and English) summarizing what changed, the effective date, and the estimated impact on a typical basket, linked to the confirmed rate dataset version. Draft creation SHALL be fail-open: a failure SHALL NOT block the rate confirmation.

#### Scenario: Confirmation creates drafts

- **WHEN** a rate dataset version is manually confirmed
- **THEN** DRAFT posts for both locales SHALL exist, linked to the confirmed version, awaiting human publication

#### Scenario: Draft failure does not block confirmation

- **WHEN** draft creation fails
- **THEN** the rate confirmation SHALL still complete and the failure SHALL be logged

### Requirement: Human publication only

Only an operator action SHALL move a post from DRAFT to PUBLISHED. The public blog endpoints SHALL return PUBLISHED posts only. Post bodies SHALL pass the content-policy lint before publication. Posts SHALL carry a kind (RATE_CHANGE default, GUIDE); the ops console SHALL additionally create and edit GUIDE-kind drafts as evergreen editorial content, and public listing endpoints SHALL filter by kind so the blog index returns RATE_CHANGE posts only and the guides index returns GUIDE posts only.

#### Scenario: Drafts invisible publicly

- **WHEN** the public blog endpoints are queried
- **THEN** DRAFT posts SHALL NOT appear in any response

#### Scenario: Operator publishes

- **WHEN** an operator publishes a post
- **THEN** it SHALL appear in the blog index or the guides index according to its kind, on its slug page, and the action SHALL be audited

#### Scenario: Operator creates a guide draft

- **WHEN** an operator creates a GUIDE-kind draft through the ops console
- **THEN** the draft SHALL exist with kind GUIDE, invisible publicly until published through the same human path

#### Scenario: Kind-filtered listings

- **WHEN** either public index is queried
- **THEN** it SHALL contain only PUBLISHED posts of its own kind, never a mix

### Requirement: Double opt-in newsletter separate from alert consent

Newsletter subscription SHALL require an explicit confirmation step delivered by email before the subscriber is considered active, and SHALL be stored independently of price-alert consent. Every newsletter email SHALL carry a one-click unsubscribe link, and unsubscribes SHALL take effect immediately.

#### Scenario: Subscription activates on confirmation

- **WHEN** a visitor submits an email address and confirms via the emailed token
- **THEN** the subscriber SHALL become active and receive subsequent newsletter sends

#### Scenario: Unconfirmed never mailed

- **WHEN** an email address is submitted but never confirmed
- **THEN** no newsletter SHALL be sent to it

#### Scenario: Immediate unsubscribe

- **WHEN** an active subscriber follows the unsubscribe link
- **THEN** the subscription SHALL end immediately and no further newsletter SHALL be sent

### Requirement: Newsletter delivery through the email worker with an intent log

Newsletter sends SHALL write a notification intent row before dispatch and mark the outcome after, through the existing email worker send path, so a retried send cannot duplicate an email already marked delivered.

#### Scenario: Crash-safe send

- **WHEN** a newsletter send retries after a mid-dispatch failure
- **THEN** subscribers already marked delivered SHALL be skipped and SHALL NOT receive a duplicate email


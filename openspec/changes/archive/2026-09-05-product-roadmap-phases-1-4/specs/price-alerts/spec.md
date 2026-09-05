# price-alerts Specification

## ADDED Requirements

### Requirement: Watchlist threshold management

An authenticated account SHALL be able to create, list, update, and pause price alerts, each consisting of a tracked product, a threshold price in euro cents, and an active or paused status. Alert endpoints SHALL require session authentication and SHALL be gated behind `enable_price_alerts`.

#### Scenario: Alert created

- **WHEN** an authenticated user posts a valid product id and threshold
- **THEN** the system SHALL store the alert bound to the account and return it with its current status

#### Scenario: Duplicate alert rejected

- **WHEN** an authenticated user posts an alert for a product they already watch
- **THEN** the system SHALL reject the request with 409 and leave the existing alert unchanged

#### Scenario: Unauthenticated access rejected

- **WHEN** the alerts API is called without a valid session
- **THEN** the request SHALL be rejected with the standard authentication error

### Requirement: Scheduled evaluation off the request path

Price-alert evaluation SHALL run as a scheduled background job after ingestion cycles, reading materialized price summaries only. User-facing requests SHALL NOT trigger evaluation and SHALL NOT observe evaluation latency.

#### Scenario: Evaluation after ingestion

- **WHEN** the ingestion cycle completes and the evaluation job runs
- **THEN** each active alert SHALL be compared against the latest materialized price for its product

#### Scenario: No evaluation on request path

- **WHEN** a user loads a product page or creates an alert
- **THEN** no threshold evaluation SHALL run as part of that request

### Requirement: Notification rate limit

The system SHALL send at most one notification per alert per 24-hour period. The cooldown SHALL be recorded on the notification row and enforced regardless of how many evaluation cycles occur within the window.

#### Scenario: Cooldown suppresses repeat sends

- **WHEN** an alert triggered within the last 24 hours matches the threshold again
- **THEN** no new notification SHALL be sent and the suppression SHALL be visible in the job's counters

#### Scenario: Re-trigger after cooldown

- **WHEN** the threshold is still met after the cooldown window has passed
- **THEN** a new notification MAY be sent and a new notification row SHALL record it

### Requirement: Delivery through the email Worker with an intent log

Alert emails SHALL be dispatched through the existing email Worker send path. The system SHALL write an `alertNotifications` row before sending and mark the outcome after, so a retried evaluation cannot double-send a notification whose row is already marked delivered.

#### Scenario: Crash-safe delivery

- **WHEN** the evaluation job retries after a failure mid-delivery
- **THEN** notifications already marked delivered SHALL be skipped and no duplicate email SHALL be sent for the same trigger

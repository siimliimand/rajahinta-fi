# price-alerts Specification

## MODIFIED Requirements

### Requirement: Watchlist threshold management

An authenticated account SHALL be able to create, list, update, and pause alerts, each consisting of a tracked product, an alert kind (PRICE or TAX_CHANGE, defaulting to PRICE), and an active or paused status. PRICE alerts SHALL carry a threshold price in euro cents; TAX_CHANGE alerts SHALL NOT require a threshold. Alert endpoints SHALL require session authentication.

#### Scenario: Price alert created

- **WHEN** an authenticated user posts a valid product id and threshold
- **THEN** the system SHALL store a PRICE alert bound to the account and return it with its current status

#### Scenario: Tax-change alert created without threshold

- **WHEN** an authenticated user posts a valid product id with kind TAX_CHANGE and no threshold
- **THEN** the system SHALL store the alert and return it with kind TAX_CHANGE

#### Scenario: Duplicate alert rejected

- **WHEN** an authenticated user posts an alert for a product they already watch with the same kind
- **THEN** the system SHALL reject the request with 409 and leave the existing alert unchanged

#### Scenario: Unauthenticated access rejected

- **WHEN** the alerts API is called without a valid session
- **THEN** the request SHALL be rejected with the standard authentication error

### Requirement: Scheduled evaluation off the request path

Alert evaluation SHALL run as a scheduled background job after ingestion cycles for PRICE alerts, and on rate-version publication for TAX_CHANGE alerts, reading materialized data only. User-facing requests SHALL NOT trigger evaluation and SHALL NOT observe evaluation latency.

#### Scenario: Price evaluation after ingestion

- **WHEN** the ingestion cycle completes and the evaluation job runs
- **THEN** each active PRICE alert SHALL be compared against the latest materialized price for its product

#### Scenario: Tax-change evaluation on publication

- **WHEN** a rate dataset version is confirmed and the evaluation runs
- **THEN** each active TAX_CHANGE alert whose tracked product's landed cost changed SHALL be selected for notification, using the tax-change attribution of the version delta

#### Scenario: No evaluation on request path

- **WHEN** a user loads a product page or creates an alert
- **THEN** no alert evaluation SHALL run as part of that request

### Requirement: Notification rate limit

The system SHALL send at most one notification per alert per 24-hour period, for both kinds. The cooldown SHALL be recorded on the notification row and enforced regardless of how many evaluation cycles occur within the window.

#### Scenario: Cooldown suppresses repeat sends

- **WHEN** an alert triggered within the last 24 hours matches its condition again
- **THEN** no new notification SHALL be sent and the suppression SHALL be visible in the job's counters

#### Scenario: Re-trigger after cooldown

- **WHEN** the condition is still met after the cooldown window has passed
- **THEN** a new notification MAY be sent and a new notification row SHALL record it

### Requirement: Delivery through the email Worker with an intent log

Alert emails SHALL be dispatched through the existing email Worker send path. The system SHALL write an `alertNotifications` row before sending and mark the outcome after, so a retried evaluation cannot double-send a notification whose row is already marked delivered.

#### Scenario: Crash-safe delivery

- **WHEN** the evaluation job retries after a failure mid-delivery
- **THEN** notifications already marked delivered SHALL be skipped and no duplicate email SHALL be sent for the same trigger

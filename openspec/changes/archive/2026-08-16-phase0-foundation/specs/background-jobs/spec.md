## ADDED Requirements

### Requirement: Background jobs off the request path

Price ingestion, transport-rate refresh, tax-dataset review, and time-series aggregation SHALL run as scheduled or queued background jobs. No background job SHALL execute on the same thread or process that handles user HTTP requests.

#### Scenario: Slow job does not block calculation

- **WHEN** a price-ingestion job takes 30 seconds to complete
- **THEN** a user requesting a landed-cost calculation in the same moment SHALL receive a response within the normal latency budget (the job runs independently)

### Requirement: Independent scheduling per job type

Each job type SHALL have its own schedule, independent of other job types. A stalled transport-rate-refresh job SHALL NOT block price ingestion or tax-dataset review.

#### Scenario: One stalled job does not stall others

- **WHEN** the transport-rate-refresh job stalls due to an upstream API failure
- **THEN** the price-ingestion job SHALL continue to execute on its own schedule

### Requirement: Job health monitoring

The background job infrastructure SHALL expose health signals (last successful run, last duration, error count) to the ops dashboard defined in the `observability` capability.

#### Scenario: Job failure surfaced

- **WHEN** the tax-dataset-review job fails three consecutive times
- **THEN** the ops dashboard SHALL show the failure with the failure count and a link to the error log
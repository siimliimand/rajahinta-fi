# application-api Specification Delta

## ADDED Requirements

### Requirement: Legacy calculation endpoints honor the request

`POST /api/v1/calculations/excise` and `POST /api/v1/calculations/landed-cost` SHALL calculate from the request body they receive, implemented directly against the excise and container-duty services. The endpoints SHALL NOT discard input or calculate a hardcoded product.

#### Scenario: Body drives the result

- **WHEN** a client posts a calculation request for a specific product and quantity
- **THEN** the response SHALL reflect that product and quantity, produced by the real excise and container-duty math

### Requirement: Redis-backed rate limiting

Rate limiting SHALL use a Redis-backed implementation behind the existing `IRateLimiter` interface so limits are shared across replicas and survive deploys. Client keys derived from `X-Forwarded-For` SHALL be trusted only when the deployment is explicitly configured behind a known proxy; otherwise the direct socket address SHALL be used.

#### Scenario: Limit shared across instances

- **WHEN** traffic for one client hits two API replicas
- **THEN** the combined traffic SHALL count against a single shared limit

#### Scenario: Forwarded header ignored at origin

- **WHEN** a client sends a spoofed `X-Forwarded-For` to an origin not configured to trust a proxy
- **THEN** the rate-limit key SHALL be derived from the socket address, not the header

### Requirement: Durable audit trail

Audit events SHALL persist to an append-only PostgreSQL table. In-memory audit storage SHALL exist only in test environments.

#### Scenario: Audit survives restart

- **WHEN** the API process restarts
- **THEN** previously recorded audit events SHALL remain queryable

### Requirement: Durable click analytics

Click analytics counters SHALL persist in Redis with periodic snapshotting so rollouts do not wipe them. In-memory counters SHALL exist only in test environments.

#### Scenario: Counters survive rollout

- **WHEN** the deployment replaces pods
- **THEN** click counters SHALL continue from persisted state

### Requirement: Unified error envelope

All API error responses SHALL conform to the documented `ApiErrorResponse` shape, including legacy controllers.

#### Scenario: Envelope conformance

- **WHEN** any controller returns an error status
- **THEN** the body SHALL parse as `ApiErrorResponse` with consistent fields

### Requirement: Decimal coercion at the repository boundary

Values returned by PostgreSQL `numeric` columns SHALL be coerced to numbers once at the repository boundary. Consumers SHALL NOT re-implement decimal parsing.

#### Scenario: Consumers receive numbers

- **WHEN** a repository returns a row containing a `numeric` column
- **THEN** the mapped entity exposes a number and no downstream service parses strings

### Requirement: Calculation record retention

Calculation records SHALL be partitioned by month, and partitions covering anonymous-session records older than the configured retention window SHALL be pruned by a scheduled job.

#### Scenario: Anonymous records pruned

- **WHEN** the retention job runs and an anonymous-session partition is older than the retention window
- **THEN** the partition SHALL be dropped and account-scoped records SHALL be unaffected

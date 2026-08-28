# deployment-observability Specification Delta

## ADDED Requirements

### Requirement: Dependency-aware health checks

Readiness SHALL verify its dependencies: a `SELECT 1` against PostgreSQL and a `ping` against Redis, each with short timeouts, with dependency status exposed in the response body. Liveness SHALL remain cheap and process-only. Kubernetes probes and the Docker healthcheck SHALL key off the appropriate endpoint so a pod with a dead dependency is not reported ready.

#### Scenario: Dead database blocks readiness

- **WHEN** PostgreSQL is unreachable
- **THEN** readiness SHALL fail and report the dependency as down in the response body

#### Scenario: Liveness stays cheap

- **WHEN** liveness is probed
- **THEN** it SHALL not perform network calls to dependencies

### Requirement: Ops dashboard is authenticated

The ops dashboard route SHALL be protected by an authentication guard and an IP allowlist (or bound to a separate internal port). Unauthenticated requests SHALL receive no operational data.

#### Scenario: Unauthenticated ops request

- **WHEN** a request without operator credentials reaches the ops dashboard from outside the allowlist
- **THEN** the response SHALL deny access without disclosing findings, coverage, or incident data

### Requirement: Structured request logging

The API SHALL emit structured JSON logs with a request ID on every request, with sensitive values redacted, replacing the in-memory KPI sampler for production paths.

#### Scenario: Request carries ID

- **WHEN** any API request completes
- **THEN** the log entry SHALL include the request ID, route, status, and duration in a structured, machine-parseable form

### Requirement: Distributed tracing

The API SHALL produce OpenTelemetry traces exportable to the configured Grafana Cloud stack via environment configuration, correlating requests across the request path and background jobs.

#### Scenario: Trace exported

- **WHEN** tracing is configured with valid export credentials
- **THEN** request spans SHALL arrive at the configured collector

### Requirement: Freshness alerting

Alerting rules SHALL exist for the freshness invariants the data-quality service computes, including stale price share and transport offer age, so degradation pages an operator instead of being discovered.

#### Scenario: Stale transport alert

- **WHEN** the newest transport offer exceeds the 7-day threshold
- **THEN** an alert SHALL fire

### Requirement: Reproducible deploys

Kubernetes manifests SHALL reference immutable image tags (SHA digests) produced by the deploy pipeline, never mutable tags. Horizontal Pod Autoscaling and a PodDisruptionBudget SHALL be configured once per-replica state is eliminated.

#### Scenario: No mutable image tags

- **WHEN** the deployment manifest is rendered
- **THEN** the image reference SHALL resolve to an immutable digest

### Requirement: Production hides non-production surfaces

Swagger UI SHALL NOT be mounted in production unless explicitly enabled by an environment flag, and the health endpoint SHALL NOT disclose the application version string.

#### Scenario: Swagger gated

- **WHEN** the API runs in production without the docs flag
- **THEN** the Swagger UI route SHALL NOT be served

# deployment-observability Specification Delta

## MODIFIED Requirements

### Requirement: Dependency-aware health checks

Readiness SHALL verify its dependencies: a D1 roundtrip query and a Durable Object ping, each with short timeouts, with dependency status exposed in the response body. Liveness SHALL remain cheap and process-only. Workers routing and any external uptime probes SHALL key off the appropriate endpoint so a Worker with a dead dependency is not reported ready.

#### Scenario: Dead database blocks readiness

- **WHEN** D1 is unreachable
- **THEN** readiness SHALL fail and report the dependency as down in the response body

#### Scenario: Liveness stays cheap

- **WHEN** liveness is probed
- **THEN** it SHALL not perform network calls to dependencies

### Requirement: Structured request logging

Request logs SHALL be structured and carry a request ID on every request handled by the API Worker, observable through Workers Logs. Log fields SHALL NOT contain credentials or secrets.

#### Scenario: Request correlation

- **WHEN** any API request is handled
- **THEN** its log entries are queryable by request ID in Workers Logs

### Requirement: Distributed tracing

The API Worker SHALL export OpenTelemetry traces to Grafana Cloud via the Workers OTLP export, configured through environment bindings. Trace context SHALL propagate from the frontend Worker to the API Worker where both handle a request.

#### Scenario: Trace reaches Grafana

- **WHEN** a calculation request is served
- **THEN** a trace for the request is exported to the configured Grafana Cloud endpoint

### Requirement: Freshness alerting

Freshness invariants (stale price share, transport age) SHALL be evaluated by a scheduled Cron handler in the API Worker. When an invariant is violated, the handler SHALL trigger an operational alert email through the email Worker. Alerting SHALL NOT depend on a Prometheus rule or cluster-side scraper.

#### Scenario: Stale price data pages the operator

- **WHEN** the stale price share exceeds its threshold at the Cron evaluation
- **THEN** the operator receives an alert email via the email Worker

## ADDED Requirements

### Requirement: Worker metrics via Analytics Engine

The API Worker SHALL emit request metrics (counts by route and status class) and freshness gauges to Workers Analytics Engine. Metrics SHALL be queryable via the Analytics Engine SQL/GraphQL API so dashboards can reproduce today's request counters and freshness gauges without a Prometheus scraper.

#### Scenario: Dashboard reproduces request counters

- **WHEN** the metrics dashboard queries Analytics Engine for a time window
- **THEN** per-route request counts and freshness gauges are returned for that window

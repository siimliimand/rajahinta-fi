# deployment-observability Specification

## Purpose

Observability and operational health for rajahinta.fi on Cloudflare Workers: dependency-aware health endpoints (D1 roundtrip + Durable Object ping), structured request logging and OTLP trace export to Grafana Cloud, request metrics and freshness gauges in Workers Analytics Engine, and freshness alerting delivered as email through the email Worker (replacing the former Prometheus/ServiceMonitor/K8s stack).

## Requirements
### Requirement: Dependency-aware health checks

Readiness SHALL verify its dependencies: a D1 roundtrip query and a Durable Object ping, each with short timeouts, with dependency status exposed in the response body. Liveness SHALL remain cheap and process-only. Workers routing and any external uptime probes SHALL key off the appropriate endpoint so a Worker with a dead dependency is not reported ready.

#### Scenario: Dead database blocks readiness

- **WHEN** D1 is unreachable
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

### Requirement: Worker metrics via Analytics Engine

The API Worker SHALL emit request metrics (counts by route and status class) and freshness gauges to Workers Analytics Engine. Metrics SHALL be queryable via the Analytics Engine SQL/GraphQL API so dashboards can reproduce today's request counters and freshness gauges without a Prometheus scraper.

#### Scenario: Dashboard reproduces request counters

- **WHEN** the metrics dashboard queries Analytics Engine for a time window
- **THEN** per-route request counts and freshness gauges are returned for that window

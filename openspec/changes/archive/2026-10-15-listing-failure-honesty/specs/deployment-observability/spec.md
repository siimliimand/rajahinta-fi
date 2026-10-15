# deployment-observability Specification

## ADDED Requirements

### Requirement: Public endpoint error alerting

The observability stack SHALL alert when the share of 5xx responses for a public listing route pattern — the unit-price ranking, catalog, search, and savings routes — exceeds a configured threshold over a sustained evaluation window, using the route-pattern × status-class counters the Worker already writes to Analytics Engine. The rule SHALL follow the provisioning conventions of the existing Grafana alert rules (documented provenance, runbook annotation, warning severity, import notes) and SHALL NOT fire on a no-data transport state.

#### Scenario: Sustained 5xx share pages the operator

- **WHEN** a public listing route's 5xx share stays above the threshold for the evaluation window
- **THEN** the alert rule fires with a runbook annotation naming the route-to-repository map

#### Scenario: Healthy endpoints stay quiet

- **WHEN** all public listing routes answer within the threshold
- **THEN** no alert fires

#### Scenario: No-data does not fire

- **WHEN** the Analytics Engine query returns no rows (transport or permission problem)
- **THEN** the rule's noDataState does not page the operator

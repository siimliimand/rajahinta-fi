# deployment-observability Specification delta

## ADDED Requirements

### Requirement: Real-user monitoring and funnel events

The frontend SHALL load the Grafana Faro Web SDK when its public endpoint configuration is present and SHALL be a full no-op when it is absent (no network calls, no instrumentation). RUM SHALL be session-scoped and identity-free: no user identifiers, no account data, and no form contents SHALL be captured, and repeat usage SHALL only be answerable at cohort level (sessions spanning distinct days), never per user. The SDK SHALL emit the named funnel events `calc_started`, `calc_result_seen`, `basket_optimized`, and `alert_set` at their flow success points, and SHALL measure client-side time-to-result from calculator submit to rendered result. Funnel events and RUM SHALL never be an input to any calculation, ranking, or ordering.

#### Scenario: No-op without configuration

- **WHEN** the frontend is built or run without the Faro endpoint configuration
- **THEN** the SDK never initializes, no telemetry requests are made, and all application flows behave identically to an instrumented build

#### Scenario: Identity-free capture

- **WHEN** any funnel event or RUM payload is emitted
- **THEN** it carries session-scoped metadata only, with no user identifier, account field, or form content

#### Scenario: Funnel events at success points

- **WHEN** a visitor starts a calculator flow, sees a rendered result, completes a basket optimization, or successfully creates a price alert
- **THEN** the corresponding named event (`calc_started`, `calc_result_seen`, `basket_optimized`, `alert_set`) is emitted exactly once for that completion

#### Scenario: Analytics are never an input

- **WHEN** any calculation, ranking, or ordering is produced
- **THEN** no funnel event, RUM signal, or aggregate derived from them contributes to the result

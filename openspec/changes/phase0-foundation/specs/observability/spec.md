## ADDED Requirements

### Requirement: Direct KPI instrumentation

The application SHALL emit structured events for the four KPI categories defined in the business plan:
- Product metrics: calculation completion rate, searches per user, saved baskets, return-user rate, calculation accuracy, stale-data rate
- Commercial metrics: free-to-paid conversion, MRR, churn, ARPU, premium feature utilization
- Data metrics: number of normalized products, active merchants, price and transport observations per day, percentage of verified vs. estimated inputs
- Compliance metrics: compliance incident count, corrected calculations, percentage of products with verified source timestamps, percentage of tax rules reviewed after legislative changes

Metrics SHALL be emitted directly from the code that produces them, not reconstructed from raw logs.

#### Scenario: Product metric available

- **WHEN** a user completes a landed-cost calculation
- **THEN** a structured event SHALL be emitted containing calculation completion data, tagged with the calculation's confidence level

#### Scenario: Metric source traceable

- **WHEN** the KPI dashboard shows a commercial metric
- **THEN** an operator SHALL be able to trace it back to the exact event emission point in the source code

### Requirement: Operational health dashboard

An internal operations dashboard SHALL expose:
- Stale-data rate: what percentage of active retail/transport offers exceed their staleness threshold
- Percentage of verified calculations: ratio of HIGH-confidence results to total calculations
- Compliance incident count and trend

#### Scenario: Health signal visibility

- **WHEN** the stale-data rate exceeds a configured threshold
- **THEN** the dashboard SHALL show a warning state and the rate SHALL be visible without clicking through sub-pages

### Requirement: Per-calculation cost attribution

Each landed-cost calculation SHALL attribute its infrastructure cost (compute, external API calls, data lookups) to the unit that produced it, so infrastructure spend can be mapped to commercial metrics.

#### Scenario: Cost tied to calculation

- **WHEN** a user requests a calculation that triggers three external API lookups
- **THEN** a cost-attribution event SHALL be emitted recording the number of lookups and the estimated cost, keyed by the user's subscription tier
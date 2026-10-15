# web-application Specification

## ADDED Requirements

### Requirement: Distinguished client-fetch failure states

A client-side listing fetch that fails SHALL map the failure to one of the enumerated classes — age-gate rejection (HTTP 403), rate limited (HTTP 429), timeout (client abort), server error (HTTP 5xx), network failure — and render the class-specific state: age-gate rejection renders the age confirmation affordance, rate limiting renders backoff copy, and the remaining classes render the transient-failure state with retry. A generic backend-unavailable message SHALL NOT be the only rendered failure state on a surface where more than one class can occur (the unit-price ranking, blog listing, and guides listing).

#### Scenario: Age gate rejection is not reported as a backend failure

- **WHEN** a visitor or crawler without age confirmation loads the unit-price ranking and the API answers 403
- **THEN** the page renders the age confirmation affordance and never renders the backend-unavailable message

#### Scenario: Server error renders transient failure with retry

- **WHEN** the API answers 5xx, or the fetch times out, or the network fails
- **THEN** the page renders the transient-failure state with a retry affordance

#### Scenario: Rate limiting renders backoff copy

- **WHEN** the API answers 429
- **THEN** the page renders copy asking the visitor to retry shortly and does not claim a backend failure

### Requirement: Stale-while-error fallback for the unit-price ranking

The unit-price ranking surface SHALL persist its last successful per-category response client-side together with the fetch timestamp. When a subsequent fetch for a category fails, the surface SHALL render the persisted response, visibly labeled with its as-of date, alongside the retry affordance, whenever a persisted response for that category exists. With no persisted response the surface SHALL render the class-distinct failure state. No persisted data SHALL ever render without its as-of label.

#### Scenario: Stale data renders on failure

- **WHEN** a category ranking was previously fetched successfully and a later fetch for that category fails
- **THEN** the persisted rows render with a visible as-of label and a retry affordance

#### Scenario: No last-good data renders the failure state

- **WHEN** a category fetch fails and no persisted response exists for that category
- **THEN** the class-distinct failure state renders without fabricated data

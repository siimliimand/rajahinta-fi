# web-application Specification

## ADDED Requirements

### Requirement: Honest transport-unavailable state

The calculator result SHALL render an explicit "transport not included — dataset pending" state when the transport component's reliability is `UNAVAILABLE`, instead of displaying a €0.00 transport line. Result amounts are never altered; only the presentation of the unavailable component changes. The LOW-confidence indication SHALL carry explanatory copy (which inputs are missing) in Finnish and English.

#### Scenario: Empty transport dataset renders honestly

- **WHEN** a calculation returns transport with `reliability: UNAVAILABLE`
- **THEN** the transport line reads as not-included with the pending-dataset explanation and no €0.00 figure is displayed

#### Scenario: Real transport data renders as before

- **WHEN** a calculation returns transport with a usable estimate
- **THEN** the transport line renders the amount as before, with no pending-state copy

### Requirement: Homepage promise honesty

The homepage savings feature card SHALL reflect the actual savings-listing state: when the savings overview reports zero products with an Alko reference (`withReference: 0`), the card SHALL render an honest reference-data-pending state instead of linking into the empty listing. Copy passes the content lint; figures stay factual with as-of context.

#### Scenario: Empty savings listing is not advertised

- **WHEN** the savings overview reports `withReference: 0`
- **THEN** the homepage card shows the honest pending state and does not link into the empty listing

#### Scenario: Populated listing restores the CTA

- **WHEN** the savings overview reports a non-zero reference count
- **THEN** the homepage card renders the existing listing CTA without any code change

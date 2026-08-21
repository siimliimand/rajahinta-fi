# web-application — Delta Spec

## ADDED Requirements

### Requirement: Correction flag affordance

The calculator result page SHALL provide a "flag a problem" affordance that submits a correction request for the displayed calculation record (via `POST /api/v1/corrections`), and the ranking methodology page SHALL link to the correction flow. The affordance SHALL confirm to the user that a review item was created.

#### Scenario: User flags a result from the UI

- **WHEN** a user activates the flag affordance on a calculator result
- **THEN** the application SHALL submit the correction request referencing the calculation record and SHALL show confirmation

#### Scenario: Methodology page links the flow

- **WHEN** a user views the ranking methodology page
- **THEN** a link SHALL be present through which a correction can be raised

## MODIFIED Requirements

### Requirement: Calculator UI

The web application SHALL provide a calculator UI to search for a product, select quantity, select transport arrangement (seller-arranged / independent carrier / personal), and display the itemized breakdown with calculation-status metadata and confidence level. When the transport arrangement is personal, the UI SHALL surface the Traveller Import outcome and its excluded-from-this-calculator messaging.

#### Scenario: User runs a calculation

- **WHEN** a user selects a product and quantity
- **THEN** the UI SHALL display the itemized breakdown with confidence level and status metadata

#### Scenario: Personal transport selection

- **WHEN** a user selects personal transport and calculates
- **THEN** the UI SHALL display the Traveller Import classification outcome and its messaging instead of a distance-selling/buying breakdown

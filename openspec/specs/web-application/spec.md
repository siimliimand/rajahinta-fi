# web-application Specification

## Purpose
TBD - created by archiving change phase1-mvp. Update Purpose after archive.
## Requirements
### Requirement: Calculator UI

The web application SHALL provide a calculator UI to search for a product, select quantity, select transport arrangement (seller-arranged / independent carrier / personal), and display the itemized breakdown with calculation-status metadata and confidence level. When the transport arrangement is personal, the UI SHALL surface the Traveller Import outcome and its excluded-from-this-calculator messaging.

#### Scenario: User runs a calculation

- **WHEN** a user selects a product and quantity
- **THEN** the UI SHALL display the itemized breakdown with confidence level and status metadata

#### Scenario: Personal transport selection

- **WHEN** a user selects personal transport and calculates
- **THEN** the UI SHALL display the Traveller Import classification outcome and its messaging instead of a distance-selling/buying breakdown

### Requirement: Explanation page

The application SHALL provide a calculation explanation page surfacing every figure's traceable inputs, rate dataset version, and timestamp.

#### Scenario: Trace a figure

- **WHEN** a user views the explanation for a result
- **THEN** each figure SHALL link back to its input value, dataset version, and timestamp

### Requirement: Neutral comparison views

Comparison views SHALL use neutral, objective ranking with no design element suggesting a paid or promoted position.

#### Scenario: No promoted styling

- **WHEN** results are ranked in a comparison view
- **THEN** no visual element SHALL indicate any paid or curated position

### Requirement: Freshness indicators

The UI SHALL surface reliability status and timestamp for every externally sourced fact.

#### Scenario: Stale price visible

- **WHEN** a price is stale
- **THEN** the UI SHALL visibly mark it stale with its timestamp, rather than presenting it like a verified figure

### Requirement: Plain outbound links

Outbound merchant links SHALL be plain links recorded for basic analytics only (click-through counts), with no purchase tracking or commission tracking infrastructure.

#### Scenario: Click recorded

- **WHEN** a user clicks a merchant link
- **THEN** the click SHALL be recorded as a count, and no purchase or commission data SHALL be collected

### Requirement: Controlled vocabulary

Product-listing copy SHALL be restricted to a controlled vocabulary (identification, classification, calculation, comparison) with no subjective adjectives. Enforcement SHALL run as an automated lint step in the content pipeline gating pull requests, not merely as a library available for ad-hoc use.

#### Scenario: Banned adjective in source

- **WHEN** generated copy or a source file contains a subjective adjective such as "best" or "amazing"
- **THEN** the content-policy lint step SHALL fail the build/CI with the offending word and context

#### Scenario: CI gate active

- **WHEN** a pull request is opened against the main branch
- **THEN** the content-policy check SHALL run as a gating job whose failure blocks the merge

### Requirement: Plain outbound links

Outbound merchant links SHALL be plain links recorded for basic analytics only (click-through counts), with no purchase tracking or commission tracking infrastructure.

#### Scenario: Click recorded

- **WHEN** a user clicks a merchant link
- **THEN** the click SHALL be recorded as a count, and no purchase or commission data SHALL be collected

### Requirement: Correction flag affordance

The calculator result page SHALL provide a "flag a problem" affordance that submits a correction request for the displayed calculation record (via `POST /api/v1/corrections`), and the ranking methodology page SHALL link to the correction flow. The affordance SHALL confirm to the user that a review item was created.

#### Scenario: User flags a result from the UI

- **WHEN** a user activates the flag affordance on a calculator result
- **THEN** the application SHALL submit the correction request referencing the calculation record and SHALL show confirmation

#### Scenario: Methodology page links the flow

- **WHEN** a user views the ranking methodology page
- **THEN** a link SHALL be present through which a correction can be raised


# web-application Specification

## ADDED Requirements

### Requirement: Buying-mode selection in the calculator

The calculator form SHALL offer a buying-mode choice between delivery (default, today's behavior) and traveller import (Otan itse mukaan). Selecting traveller mode SHALL send `transportArrangement: 'PERSONAL'` with the calculation request. Traveller-mode results SHALL render the within/surplus-allowance split with reliability statuses, the allowance dataset version, and the single-traveller assumption note. The no-dataset rejection SHALL render an honest unavailable state for the traveller mode with retry-later copy while the delivery mode stays usable; no invented figures are displayed.

#### Scenario: Toggle switches the request scenario

- **WHEN** the customer selects traveller import and calculates
- **THEN** the request carries `transportArrangement: 'PERSONAL'` and the result renders the allowance-aware breakdown with the dataset version

#### Scenario: Traveller mode without allowance data renders honestly

- **WHEN** the traveller-mode calculation rejects for lack of an effective allowance dataset
- **THEN** the form shows the honest unavailable explanation, the delivery mode remains selectable, and no figures are fabricated

#### Scenario: Finnish and English copy in parity

- **WHEN** any new calculator string is rendered
- **THEN** Finnish and English messages exist in parity and pass the content lint

### Requirement: Traveller callout on delivery results

Delivery-mode calculation results SHALL render the `travellerAlternative` estimate when present, as a clearly labeled estimate (allowance framing, dataset version) with a link into the trip calculator pre-filled with the product and quantity (`/trip?product={id}&quantity={n}`). Delivery-mode amounts render exactly as before; the callout never replaces or restyles them as uncertain.

#### Scenario: Callout links into a pre-filled trip

- **WHEN** a delivery result carries a non-null `travellerAlternative`
- **THEN** the page shows the labeled traveller estimate and the link opens the trip calculator with the product and quantity pre-seeded

#### Scenario: Trip page accepts the prefill

- **WHEN** the trip page is opened with `product` and `quantity` query parameters
- **THEN** the fill form is pre-seeded with that product and quantity and the existing validation applies unchanged

### Requirement: Search suggestion banner

The calculator product search and the product-listing search SHALL render the response's `suggestion` (when present) as a clickable "Tarkoititko: {suggestion}?" control that runs the suggested query. The banner SHALL NOT appear when the query returned results, and the customer's original query text SHALL remain displayed as entered.

#### Scenario: Zero-result query offers the correction

- **WHEN** a search returns zero results with a suggestion
- **THEN** the surface shows the Tarkoititko control and clicking it runs the suggested query

#### Scenario: Original query is preserved

- **WHEN** a suggestion banner is shown
- **THEN** the search input still contains the customer's original query, and no automatic rewriting has occurred

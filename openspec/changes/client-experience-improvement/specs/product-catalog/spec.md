# product-catalog Specification

## ADDED Requirements

### Requirement: Clickable merchant offers on product detail

Product-detail offers SHALL render the merchant as a clickable outbound call-to-action through `GET /api/v1/outbound/:offerId`, matching the compare page's existing outbound behavior. The CTA copy ("Katso kaupassa →" / "View at store →") SHALL make clear that the visitor is leaving Rajahinta.

#### Scenario: Offer renders as an outbound CTA

- **WHEN** a product detail page lists an offer with a source URL
- **THEN** the offer renders a labelled call-to-action that routes through the outbound redirect controller for that offer id

#### Scenario: Click analytics stay intact

- **WHEN** a visitor follows the outbound CTA
- **THEN** the click records through the same redirect controller the compare page uses

### Requirement: Stock availability display

Offers SHALL surface their stock status (`in_stock`, `low_stock`, `out_of_stock`) as a localized badge. Out-of-stock offers SHALL remain visible (price-history context) but SHALL be visually de-emphasized and SHALL be excluded from calculator and allowance-fill default selections. The badge reflects the last observed state with the existing reliability status and timestamp.

#### Scenario: Out-of-stock offer is de-emphasized and skipped by defaults

- **WHEN** a product's cheapest offer is out of stock and a cheaper-alternative default is assembled for the calculator
- **THEN** the offer renders with an out-of-stock badge in de-emphasized styling and is not selected as a default

### Requirement: Distance-selling status guidance

Each offer SHALL carry a status badge derived from the seller-country signal: Etämyynti (the merchant handles Finnish alcohol tax; no buyer steps) or Etäosto (the buyer arranges transport and declares excise; links to the etäosto guide). The badge SHALL be an additive display field that never enters a calculation or ranking input, and the guidance SHALL be framed as general information, not legal advice, in an empowering rather than warning tone.

#### Scenario: Estonian seller shows etäosto guidance

- **WHEN** an offer's seller country differs from FI
- **THEN** the offer renders the Etäosto badge with a link to the etäosto guide

#### Scenario: Badges never alter results

- **WHEN** calculation or ranking output is compared across zero, one, and many status badges present
- **THEN** the output is byte-identical in all cases (compliance-pinned)

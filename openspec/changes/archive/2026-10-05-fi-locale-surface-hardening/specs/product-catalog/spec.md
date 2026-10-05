# product-catalog Delta

## MODIFIED Requirements

### Requirement: Clickable merchant offers on product detail

Product-detail offers SHALL render the merchant as a clickable outbound call-to-action through `GET /api/v1/outbound/:offerId`, matching the compare page's existing outbound behavior. The CTA copy ("Katso kaupassa →" / "View at store →") SHALL make clear that the visitor is leaving Rajahinta. The merchant SHALL be presented under its registry display name where one exists, with the raw merchant identifier as fallback; the identifier remains the wire contract and the redirect/analytics key.

#### Scenario: Offer renders as an outbound CTA

- **WHEN** a product detail page lists an offer with a source URL
- **THEN** the offer renders a labelled call-to-action that routes through the outbound redirect controller for that offer id

#### Scenario: Click analytics stay intact

- **WHEN** a visitor follows the outbound CTA
- **THEN** the click records through the same redirect controller the compare page uses

#### Scenario: Registry display name shown, identifier preserved

- **WHEN** an offer's merchant has a display name in the merchant registry
- **THEN** the offer row (and the offer-facing merchant selects it feeds) presents the display name, while the outbound redirect, analytics, and API fields continue to use the merchant identifier

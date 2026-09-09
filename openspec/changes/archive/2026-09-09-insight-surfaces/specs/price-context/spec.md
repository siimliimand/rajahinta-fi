# price-context Specification

## ADDED Requirements

### Requirement: Trailing-window price context per product

A public API endpoint SHALL return, for one product, price context computed over the trailing 90 days of the product-wide daily price-history buckets (merchant-null rows only): the current best observed price (the lowest current offer price, the same selection rule the product page uses), the median, minimum, and maximum of the window, and the delta of the current price versus the median in euro cents and basis points. Every value-bearing response SHALL include the window length in days, the bucket count, and the as-of date. The endpoint SHALL be age-gated and rate-limited under the historical profile.

#### Scenario: Context computed over the window

- **WHEN** the endpoint is queried for a product with a populated 90-day history
- **THEN** the response SHALL carry the current best price, window median, minimum, maximum, delta versus median in cents and basis points, window length, bucket count, and as-of date

#### Scenario: Consistent best-price selection

- **WHEN** the product page shows a best price for the same product and moment
- **THEN** the context endpoint's current price SHALL be the same figure, derived from the same lowest-current-offer rule

### Requirement: Insufficient history renders no percentage

When the window contains fewer than a configured minimum of daily buckets, the endpoint SHALL return an explicit unavailable result with a reason instead of a percentage, and the product page SHALL render an honest "not enough history yet" state. No contextual percentage SHALL ever be displayed over thin data.

#### Scenario: Thin history

- **WHEN** the product's 90-day window contains fewer buckets than the configured minimum
- **THEN** the endpoint SHALL return an unavailable result with the reason, and the product page SHALL show the insufficient-history state rather than a percentage

### Requirement: Factual rendering without advice

The product page SHALL render the context as one factual sentence stating the delta versus the median together with the window and as-of date. The copy SHALL NOT contain advice, prediction, or purchase-urging phrasing, and the content-policy lint SHALL treat advice phrasing on this surface as a violation.

#### Scenario: Context line renders facts

- **WHEN** a visitor opens a product page with sufficient history
- **THEN** the page SHALL show the delta versus the 90-day median with the window and as-of date, phrased as a factual comparison

#### Scenario: Advice phrasing rejected

- **WHEN** a message catalog or guide body contains advice phrasing such as "good time to buy" on this surface
- **THEN** the content-policy lint SHALL fail

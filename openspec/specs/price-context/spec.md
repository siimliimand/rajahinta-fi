# price-context Specification

## Purpose
TBD - created by archiving change insight-surfaces. Update Purpose after archive.
## Requirements
### Requirement: Trailing-window price context per product

A public API endpoint SHALL return, for one product, price context computed over the trailing 90 days of the product-wide daily price-history buckets (merchant-null rows only): the current best observed price (the lowest current offer price, the same selection rule the product page uses), the median, minimum, and maximum of the window, and the delta of the current price versus the median in euro cents and basis points. The response SHALL additionally carry the current price's percentile rank within the window's daily buckets — the share of buckets strictly above the current price, expressed in integer basis points with deterministic rounding — and the derived `isWindowLow` fact stating whether the current best price equals the window minimum. Both new figures SHALL be unavailable under the same minimum-bucket gate as every other value-bearing figure, and SHALL use exact integer arithmetic with no floating-point intermediate. Every value-bearing response SHALL include the window length in days, the bucket count, and the as-of date. The endpoint SHALL be age-gated and rate-limited under the historical profile.

#### Scenario: Context computed over the window

- **WHEN** the endpoint is queried for a product with a populated 90-day history
- **THEN** the response SHALL carry the current best price, window median, minimum, maximum, delta versus median in cents and basis points, the percentile rank in basis points, the `isWindowLow` fact, window length, bucket count, and as-of date

#### Scenario: Consistent best-price selection

- **WHEN** the product page shows a best price for the same product and moment
- **THEN** the context endpoint's current price SHALL be the same figure, derived from the same lowest-current-offer rule

#### Scenario: Percentile rank is deterministic

- **WHEN** the same window buckets and current price are computed twice
- **THEN** the percentile rank SHALL be identical, derived as the share of buckets strictly above the current price in integer basis points with no floating-point intermediate

#### Scenario: Window-low fact

- **WHEN** the current best price equals the minimum of the window's daily buckets
- **THEN** the response SHALL carry `isWindowLow` as true, and SHALL carry false when the current price is above the minimum

### Requirement: Insufficient history renders no percentage

When the window contains fewer than a configured minimum of daily buckets, the endpoint SHALL return an explicit unavailable result with a reason instead of a percentage, and the product page SHALL render an honest "not enough history yet" state. No contextual percentage SHALL ever be displayed over thin data.

#### Scenario: Thin history

- **WHEN** the product's 90-day window contains fewer buckets than the configured minimum
- **THEN** the endpoint SHALL return an unavailable result with the reason, and the product page SHALL show the insufficient-history state rather than a percentage

### Requirement: Factual rendering without advice

The product page SHALL render the context as factual sentences stating the delta versus the median together with the window and as-of date. When `isWindowLow` is true, the page SHALL additionally state factually that this is the lowest observed price in the window; otherwise it MAY state the percentile rank as a share of days in the window ("cheaper than X% of the days in this window"). The copy SHALL NOT contain advice, prediction, or purchase-urging phrasing, and the content-policy lint SHALL treat advice phrasing on this surface as a violation. Both locales SHALL carry the new phrasings.

#### Scenario: Context line renders facts

- **WHEN** a visitor opens a product page with sufficient history
- **THEN** the page SHALL show the delta versus the 90-day median with the window and as-of date, phrased as a factual comparison

#### Scenario: Window-low phrasing is factual

- **WHEN** the context carries `isWindowLow` true
- **THEN** the page states that this is the lowest observed price in the stated window, without any purchase-urging phrasing

#### Scenario: Percentile phrasing is factual

- **WHEN** the context carries a percentile rank and `isWindowLow` is false
- **THEN** the page MAY state the rank as a share of days in the window, carrying the window and as-of context, phrased as a distribution fact rather than advice

#### Scenario: Advice phrasing rejected

- **WHEN** a message catalog or guide body contains advice phrasing such as "good time to buy" on this surface
- **THEN** the content-policy lint SHALL fail


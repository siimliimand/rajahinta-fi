# product-catalog Specification

## ADDED Requirements

### Requirement: Current offer per merchant on product detail

The product detail response and page SHALL display at most one retail offer per merchant: the latest observed row for that (product, merchant), latest = greatest `observed_at` with `id` as tiebreak. Repeated scrapes of an unchanged price SHALL collapse into that single row carrying the current price and the last-observed date. Write-side storage SHALL remain append-per-scrape — the collapse is a read contract, and the scrape log keeps every check.

#### Scenario: Unchanged price collapses

- **WHEN** a merchant's price for a product is scraped repeatedly without changing
- **THEN** the product detail shows one row for that merchant with the price and the most recent observed date

#### Scenario: Price move supersedes

- **WHEN** a merchant's price for a product changes
- **THEN** the product detail shows the new price with the newer observation date, and only that row

#### Scenario: Lowest-price computation unaffected

- **WHEN** the best-price or unit-price embeds are computed from the deduped offer set
- **THEN** the results equal those computed over the full scrape log, because superseded rows for a merchant carry no lower price

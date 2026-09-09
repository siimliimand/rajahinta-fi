# alks.fi feed and import VAT

## Why

alks.fi is the first cross-border merchant on the site. It sells from a warehouse in Germany, the buyer arranges their own transport, and the buyer pays Finnish import VAT at the border. Pricing an alks.fi basket is exactly what this calculator exists to do, and two gaps block it today. First, there is no feed adapter for the store, so no products. Second, the landed-cost engine has no import-VAT term: `totalCents` sums retail price, transport, excise, and container duty. A foreign-seller estimate without import VAT understates the total by roughly a quarter of the tax base, so both halves ship in one change rather than putting wrong totals on the site.

The alks.fi catalog is reachable through the public WooCommerce Store API (`/wp-json/wc/store/v1/products`, about 2,856 products, EUR, prices in minor units), so ingestion needs no agreement and no page scraping. The payload includes image URLs; per the owner decision those stay unused and image handling is deferred.

## What Changes

### Ingestion: alks.fi through the WooCommerce Store API

- New `AlksFeedAdapter` in data-acquisition, the second live adapter beside Alko. It paginates the Store API (100 per page, bounded by `X-WP-TotalPages`, sequential requests) and maps rows to `RawFeedRecord`.
- The EAN comes from the SKU after stripping the two-letter warehouse prefix (`de-4740077005916` becomes `4740077005916`). Each row validates against `^[a-z]{2}-\d{13}$`; a non-matching SKU produces a correction error and a record without an EAN.
- ABV, volume, and container type are parsed from the product name and cross-checked against categories. A product whose name does not yield these fields is still ingested, with the affected fields marked ESTIMATED (owner decision). No record is dropped for a parse failure.
- Product weight is persisted on the product master (new `weight_grams` column) and used by transport estimation when present; the volume-based estimate stays as the fallback.
- New merchant-registry seed row `alks` (`feedUrl https://alks.fi`, json, hourly cadence). Governance: the source is registered as `RETAILER_API` and granted through the operator console in staging; the runbook documents the production step. The default PENDING status stays in effect until a human grants it.

### Calculation: import VAT

- New core-domain vat module with a versioned rate dataset: 24% before 2024-09-01, 25.5% from 2024-09-01. Effective-date resolution follows the excise dataset pattern, so past calculations resolve against the rate effective on their date.
- The VAT base (retail price + transport + alcohol excise + container duty) is itself a versioned rule, not a hardcoded formula.
- The calculator gains an itemized import-VAT line carrying the rate version, the base breakdown, and a reliability status. The line applies when the seller country differs from the destination; domestic offers keep byte-identical results, pinned by the compliance suite.
- The VAT dataset version joins the idempotency cache-key composition beside the tax and transport versions.

## Non-goals (this change)

- No image ingestion or display. The adapter ignores image fields entirely.
- No change to Alko feed behavior, ranking, or neutrality mechanics.
- No minimum-order terms for alks; `merchant_terms` stays null, which means eligible.
- No new transport carriers. The estimation change only prefers a stored weight when one exists.

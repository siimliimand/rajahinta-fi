# Drop Sweden, go EUR-only, add the Alko benchmark

## Why

Finns do not order alcohol from Sweden; Systembolaget does not ship to Finland, so the site's only live merchant feed models a corridor that does not exist. The cross-border corridors Finnish customers actually use (Baltic and German, ferry and road travel) are all EUR markets. Cutting Sweden and going EUR-only removes the entire FX apparatus as dead weight, simplifies ingestion, and lets the copy finally match reality. With the Alko domestic reference feed becoming the pricing anchor, a factual benchmark against Alko belongs in the same repositioning.

This change also resolves two findings from the 2026-09-05 customer audit: the homepage promise ("from Sweden and across Europe") that the data cannot back, and the SEK provenance surface that only existed to serve the Swedish feed.

## What Changes

### Sweden out, clean cut

- Delete `SystembolagetFeedAdapter`, its tests, its export, and its DI/registry wiring in `packages/data-acquisition`. The adapter registry holds Alko only.
- Rewire the api-worker ingestion path (`queues/pipeline.ts`, `workflows/ingestion-steps.ts`, `core-domain-bridge.ts`) to a no-FX, Alko-only composition.
- Purge queryable Systembolaget data in existing environments: products, retail offers, price-history summaries, merchant-registry rows, and governance records. Seeds updated accordingly.
- The R2 append-only observation log stays intact per the data-immutability principle. It is no longer queried; deletion of history is out of scope and can be a separate governance decision.
- German and Estonian feeds are explicitly deferred to future changes.

### EUR-only, FX machinery removed entirely

- Delete the core-domain FX module (`packages/core-domain/src/fx/**`), the ECB rate source, and the FX dataset review service/adapters in data-acquisition.
- Delete the `fx-dataset-review` cron handler and remove its pattern from `wrangler.jsonc` (all environments) and the infra environment descriptions.
- Remove the FX dataset version from idempotency cache-key composition (Nest `IdempotencyService` and the api-worker `IdempotencyDO`). Tax and transport version components stay.
- Remove the FX publish flow from the operator console (API routes, service methods, console UI section).
- Drop the `fx_rate_datasets` and `fx_rates` tables and the `retail_offers` provenance columns (`original_price_cents`, `original_currency`, `fx_dataset_version`) through forward migrations on both the legacy Postgres schema and D1. The `currency` column stays, pinned to `'EUR'` by an invariant (see design).
- Remove SEK from currency unions and delete the unconvertible-offer exclusion path in the calculator and data mapping.
- Remove `'SE'` from the event calculator's `SOURCING_COUNTRY_ORDER`, its validation, fixtures, and the fi/en country labels.

### Alko benchmark (display-only)

- New pure module in core-domain: compare the selected offer against the product's Alko reference offer. Output: reference price, difference in euros and percent, reliability status, observation timestamp; unavailable when no reference offer exists.
- The calculator response and persisted calculation record gain an optional `alkoBenchmark` field. Absent on records created before this change; the UI hides the line when the field is missing.
- The benchmark never enters the landed-cost total, any calculation input, or any ranking input. A compliance test pins output invariance.

### Copy honesty

- Hero and trust-row copy (fi/en) stop naming Sweden and Systembolaget. Country-label entries for Sweden are removed. All copy passes the content-policy lint in both locales.

## Non-goals (this change)

- No new merchant feed adapter (Germany, Estonia deferred).
- No deletion of R2 observation history.
- No changes to tax-rule versioning, launch gates, or feature-flag mechanics.

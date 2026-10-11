# Ferry onboard price watch

## Why

The site answers "Finland vs cross-border webshop — where is this bottle cheapest, and what am I allowed to carry home?" but the Baltic ferry onboard shops (Tallink Silja, Viking Line, Eckerö pre-order catalogs) are a missing seller context in exactly the journey where the question arises: trip planning. The trip page already carries a curated `ferryOffers` affiliate-links block and resolves sea-traveller allowances against the published Commission Directive 2007/74/EC dataset — the legal and affiliate scaffolding exists; only the observed onboard prices are absent.

This change adds them **display-only, never as calculation inputs**. Ferry shops do not ship to the door, so their prices cannot enter the landed-cost engine's merchant-offer universe; the trip calculator's own allowance math remains the only computation path. Observed onboard prices are curated facts with operator, route, observed-at, and citation — the same trust shape as the curated carrier-rate datasets.

## What Changes

### Sweep before wiring (gate)

- A read-only sweep probes the three operators' pre-order shops for feed shape, currency (EUR expected on FI routes), category vocabulary, product-label overlap with the catalog, and terms-of-use posture. Findings and a go/no-go recorded in the change notes before dataset work proceeds.

### Curated ferry price observations (no live feed assumed)

- New in-repo curated dataset `ferry-price.source.ts` on the Fransberg/Posti model: operator-transcribed onboard prices per operator, route, and observation date, EUR minor units, every row carrying a citation. Ingested by the monthly curated-rate-refresh cron into a new `ferry_price_observations` D1 table behind the existing governance gate (operator grant per operator key). If the sweep finds a sanctioned live feed, the source generalizes — the dataset shape does not change.

### Display-only trip surface

- The trip fill/feasibility responses gain an additive `ferryPrices` block (operator, route, label, price, observed-at, citation) beside the existing `ferryOffers` links block. Age gate, rate limits, idempotency, and every existing field byte-identical; the `trip-affiliate-neutrality` compliance test extends to prove calculation output is identical with zero, one, and many price rows.
- The trip result page renders a collapsed "Laivaston havaitut hinnat" block with the as-of date, route, and citation, an explicit observed-facts disclaimer, and a designed nothing state when no published rows exist. FI + EN with content-lint parity.

## Non-goals (this change)

- No merchant-registry onboarding of ferry shops; no `retail_offers` or `product_master` rows; no landed-cost, basket, ranking, or savings participation of any kind.
- No EAN/product-master joining — rows carry display labels only, keeping the HIGH-LIABILITY producer-matching module untouched.
- No product-page surface (a possible follow-up once coverage justifies it).
- No auto-scraping; curated monthly transcription unless the sweep documents a sanctioned feed.
- No route-specific allowance-content authoring (Åland vs Tallinn duty-free status) — that is an operator dataset act on the existing versioned allowance machinery, noted as follow-up.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-feasibility-calculator`: new display-only observed-onboard-price requirement alongside the neutral affiliate slot — additive block, provenance required, byte-identity enforced, honest empty state.
- `data-acquisition`: new curated ferry onboard-price source family on the curated-dataset pattern (governance-gated, monthly refresh, citation-required rows, EUR minor units).

## Impact

- `packages/data-platform` (migration: `ferry_price_observations`; `FerryPriceRepository`), `packages/data-acquisition` (`ferry-price.source.ts`, curated-refresh cron wiring), `apps/api-worker` (trip routes embed the additive block; cron registration), `apps/frontend` (trip result block, FI/EN messages), `tests/compliance` (byte-identity extension).
- Data: one D1 migration; governance rows per operator per environment as an operator step.
- No dependency changes; no existing endpoint contract changes (additive response fields only).

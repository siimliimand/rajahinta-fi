# Proposal: savings-first-catalog-and-prefill

## Why

The 2026-10-06 user feedback documented a first-impression defect across every
primary surface: the calculator, compare, and basket pages open on "nothing
added yet" and ask the visitor to search first; the products catalog opens on a
~443-page alphabetical wall ("1 Enkelt Bitter", "1+1=3 Cava") showing retailer
prices — not the landed cost to Finland the site exists to explain. The numbers
that would fix this are already computed daily: the savings-snapshot
materialization carries each covered product's full landed cost (quantity 1,
FI destination, seller-arranged transport), its Alko reference, the gap in
integer cents and basis points, and full provenance (merchant, observation
timestamps, tax dataset version, reliability/confidence). The defect is a
publication gap, not a data gap.

The default-sort decision history matters: `first-impression-pass` set
LOWEST_PRICE (a wall of €0.49 German miniatures), `catalog-first-run-polish`
flipped to ALPHABETICAL (today's junk-name wall). Both defaults ordered the
catalog by a field irrelevant to the site's value proposition. The third
default orders it by the value proposition itself: the biggest current saving.

## What Changes

- Catalog listing gains a `BIGGEST_SAVING` sort order and becomes the absent-sort
  default: gap basis points ascending (largest saving first), FI product name and
  product id as deterministic tie-breaks; products without a savings row list
  last, alphabetically. ALPHABETICAL, LOWEST_PRICE, and ALCOHOL_PERCENTAGE remain
  explicit options; unknown values still 400 at the API.
- Every `/api/v1/products` item with a latest-day snapshot row carries a
  display-only `savings` embed (landed total, Alko reference, gap, reliability,
  confidence); the response carries `savingsAsOf`. The join is composed at the
  worker-route display layer — the product-search repository never imports a
  savings module (savings-snapshot-isolation static scan stays green).
- Catalog cards render the landed cost and Alko gap beside the existing
  "from" price, reusing the /savings vocabulary; an absent embed renders nothing
  (the €/g chip's render-nothing precedent). In the default order, uncovered
  rows follow a quiet divider under an honest "no Alko reference" label.
- Catalog pagination is windowed (prev/next, first/last, ±2 window with
  ellipsis) — the current page renders every page number (~443 links) into the
  DOM.
- New read endpoint `GET /api/v1/savings/best-per-merchant`: the latest day's
  rows grouped by best merchant, argmax |gap| per merchant with the product-id
  tie-break, merchant `alko` excluded (the domestic reference is not a deal).
  A newly onboarded merchant's best deal joins automatically on first
  materialization — no editorial step.
- Calculator, compare, and basket gain example prefills from that endpoint:
  the calculator renders example cards with the snapshot figures (no
  calculation call — drive-by opens never create calculation records);
  compare opens with one best-deal column per cross-border merchant; the
  basket empty state lists the deals with per-item add and a one-click
  example-basket fill. All prefill content is example-labeled and links to
  /savings.
- "Most searched" from the feedback is deliberately reframed as the
  deterministic biggest-savings ordering rather than new popularity
  instrumentation: no search-term logging is added (none exists today; a
  query log would need a data-minimization review), and the savings code's
  "no editorial picks, no trending, no boost" stance is preserved.

## Capabilities

- `product-search` — MODIFIED *Server-side catalog sorting* (BIGGEST_SAVING
  default, nulls last); ADDED *Catalog listing savings embed* (route-level,
  display-only, savingsAsOf).
- `product-catalog` — MODIFIED *Browsable catalog page* (landed-cost columns,
  no-reference tier, default state); MODIFIED *Pagination over the filtered
  catalog* (windowed pagination).
- `savings-discovery` — ADDED *Best deal per merchant listing*.
- `web-application` — MODIFIED *Calculator UI* (example prefill cards);
  MODIFIED *Neutral comparison views* (example-labeled prefill columns);
  MODIFIED *Basket builder and optimization UI* (example-basket fill action).

## Out of Scope

- Homepage surfaces: the `homepage-live-gap-hero` draft (DRAFT,
  2026-10-06) owns the homepage hero; this change owns products and tools.
- Search-term analytics of any kind.
- ABV/price-range facets; category counts (future filter work).
- Product detail pages ([id]) — the landed-cost block there deserves its own
  change once the catalog columns' vocabulary settles.

## Sequencing Notes

- `nonalcoholic-catalog-hygiene` (in-progress, 0/5) adds a read-path predicate
  holding 0%-ABV/unknown-ABV rows out of user-facing surfaces — including the
  catalog listing. Both changes touch `apps/api-worker/src/routes/search.routes.ts`;
  if both are in flight, the hygiene predicate lands first and this change's
  route work rebases on it.
- The daily snapshot's reordering does not fragment SEO: catalog canonical
  URLs already exclude the `sort` parameter, and the default view's content
  churn is bounded by the daily grain (the /savings page already behaves this
  way).

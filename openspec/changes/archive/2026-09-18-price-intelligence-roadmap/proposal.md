# Price intelligence roadmap

## Why

Four independent external analyses of rajahinta.fi (UX, SEO, trust, and crawlability reviews) converge on one structural finding: nearly all page content is invisible to crawlers and to users before JavaScript runs. The root cause is verified in the repo — `AgeGate` renders an empty placeholder during SSR, so every page ships only header, footer, and JSON-LD. All four reviews therefore undercounted the product: share permalinks, price alerts, saved baskets, blog, guides, curated lists, product pages, sitemap, robots, and per-page metadata already exist. The gap is narrower and more fixable than the reviews assumed.

The same reviews produced a coherent repositioning: from "a collection of calculators" to "the tool that tells you the real cost of buying beverages abroad." Existing functionality maps onto that promise directly (calculator = real cost, compare = which is cheaper, basket = whole purchase, trip = is travel worth it, event = event cost, what-if = how the answer changes, products = the data).

This change implements the reconciled roadmap in five phases: crawlable age gate, server shells with unique metadata for the tool pages, trust and conversion surfaces, calculator UX upgrades, and data-product depth.

## What Changes

### Phase 0 — crawlable age gate (root cause)

- `RootLayout` reads the `age_confirmed` cookie server-side and passes the decision to `AgeGate` as initial state. Page content always renders in the server HTML.
- `AgeGate` becomes an overlay for unconfirmed visitors instead of a content replacement. The declined path, the 403 recovery event, and the 90-day cookie TTL are unchanged. API-side enforcement is unchanged (`ageGate` middleware keeps 403ing gated endpoints; SSR data fetches keep using `SERVER_AGE_CONFIRMATION_TOKEN`).
- Gate copy reworded to plain local-storage language, replacing "A local flag is stored in your browser."

### Phase 1 — server shells and metadata for tool pages

- `calculator`, `compare`, `basket`, `trip`, `event`, `what-if`, and `ranking` convert from client-only page shells to the established server-shell + client-view pattern (the `group-order`, `ops`, and `value` precedent): unique `generateMetadata` per page, server-rendered intro, and a "How this calculation works" section.
- `value` gains the metadata it lacks entirely.

### Phase 2 — trust and conversion surfaces

- Homepage worked-example section: a static, server-rendered example calculation with figures explicitly labeled as examples.
- `SiteHeader` gains a Planning dropdown (trip, event, what-if) and an `FI | EN` locale switcher (languages are currently footer text only).
- New About and Contact pages, added to the sitemap.
- Register page states account benefits (price alerts and saved baskets already exist).
- Homepage FAQ section linking published guide entries.

### Phase 3 — calculator UX

- Result-first result card: prominent estimated landed cost, breakdown beneath, Finland comparison, reliability status and timestamp from the existing reliability model, and the structural disclaimer consumed from the result object.
- Quick-calculate / advanced-options progressive disclosure.
- Trip route presets (Helsinki–Tallinn ferry patterns with fuel and ticket defaults) and event templates (occasion, guests, duration, drink mix).
- Trip break-even figure: transport and other costs divided by per-unit saving, displayed with its formula and inputs.
- Sticky two-column summary on calculator and basket (desktop).
- "What-if" relabeled "Scenario calculator" (copy only; the `/what-if` URL stays).
- Form pass: units beside fields, numeric keyboards on mobile, inline validation.

### Phase 4 — data product

- Price-history chart on product pages (30/90/365-day) from the existing historical API, with a data-table alternative.
- Market overview on `/savings`: deterministic aggregates (average observed price per category, largest observed cross-border difference, observed product count).

### Content

- FAQ published as guide entries (the guides platform already exists); no new route.

## Non-goals (this change)

- No new calculation engines — Phase 3 is presentation over existing result objects; break-even is a displayed derivation of existing figures.
- No URL or route changes — no redirects; `/what-if` stays.
- No account-gating of calculations — calculate-first, register-later stays.
- No confidence scores — reliability uses the existing reliability-status model only.
- No checkout, payment, or shop features.
- No feature flags — everything ships unconditionally; rollback is `wrangler rollback`.
- No change to API gating semantics — the gate stays a 403 on gated endpoints.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `accounts-age-gate`: soft-gate presentation — content in server HTML, modal overlay for unconfirmed visitors, API enforcement unchanged.
- `web-application`: unique metadata for every public route, server shells for tool pages, header Planning dropdown and locale switcher, homepage worked example and FAQ section, About and Contact pages, register benefits copy.
- `landed-cost-calculator`: result-first result card with reliability timestamp and consumed structural disclaimer; quick/advanced split; form units and validation; sticky summary.
- `trip-feasibility-calculator`: route presets, break-even figure with formula, allowance hint.
- `event-calculator`: occasion templates.
- `excise-what-if-simulator`: "Scenario calculator" labeling with example scenarios; URL unchanged.
- `basket-optimization`: sticky summary presentation.
- `historical-price-intelligence`: product-page price-history chart with table alternative.
- `savings-discovery`: deterministic market-overview aggregates.
- `guides-hub`: FAQ entries published as guides.

## Impact

- `apps/frontend`: `layout.tsx`, `AgeGate.tsx`, seven tool-page conversions, `SiteHeader`, homepage, `value`, register copy, About/Contact routes, `sitemap.ts`, `messages/en.json` + `messages/fi.json`, product-page components, savings page, test files alongside each.
- `apps/api-worker`: at most one new aggregate endpoint for market overview (deterministic, objective).
- No schema, migration, or pipeline changes.
- Risk note: the gate refactor must avoid hydration mismatch (server passes the initial decision; the client does not re-derive it before first paint) and must not regress the age-gate coverage tests.

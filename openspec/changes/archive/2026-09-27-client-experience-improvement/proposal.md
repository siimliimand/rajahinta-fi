# Client experience improvement (Phases 0–4)

## Why

`docs/client-experience-improvement-plan.md` (2026-09-26, validated against `master`) audited the user-facing layer and found the frontend experience lagging the quality of the backend engines. The audit groups the gaps into trust-breaking patterns (a hero search bar that is not an input, an age-gate decline dead end), missing e-commerce expectations (no catalog search, unclickable merchant names), and friction that punishes normal use (manual €/l entry, login-walled trip fill, a 10-item basket cap, 10 req/min calculator limits).

Every claim was re-verified against the current `master` before this proposal:

- Hero "search" is a decorative `<div>` with a placeholder `<span>` linking to `/calculator` (`apps/frontend/src/app/[locale]/page.tsx`, "Decorative search field" comment) — confirmed.
- `/products` has category pills and pagination but no search input; URL state carries only `category` and `page` — confirmed.
- `D1ProductSearchRepository.searchRanked(query, limit)` takes no category parameter, so a category filter is silently ignored whenever `q` is present — confirmed.
- The age-gate declined page renders a title and body only, with no recovery path — confirmed.
- `POST /api/v1/trip/fill` sits behind `requireRateLimit('CALCULATOR')` → `sessionAuth()` → `requireFeature('calculation:basic')` (`apps/api-worker/src/routes/trip.routes.ts`) — confirmed.
- `MAX_BASKET_ITEMS = 10` (`packages/core-domain/src/optimizer/optimizer.types.ts`) — confirmed.
- `CALCULATOR` and `BASKET` rate profiles are 10 req/min (`apps/api-worker/src/middleware/rate-limit.ts`) — confirmed.
- Merchant names on product pages are plain text; the clickable `MerchantLink` component exists only under `compare/` — confirmed.
- **Stale claim:** "sort options return HTTP 400" no longer reproduces — today's catalog has no sort controls and the compare page sorts client-side. The server-side repository never implemented price/ABV sort. Per decision of the change owner, this change implements server-side sorting (the source doc's own recommendation) rather than only removing controls.

## What Changes

### Phase 0: stop active trust damage

- The homepage hero becomes a real `<form>` with a functional `<input type="search">`; submitting navigates to `/calculator?q={term}` and the calculator pre-fills its search from the `q` parameter.
- `GET /api/v1/products` gains server-side sorting: `LOWEST_PRICE` (by lowest observed offer price), `ALCOHOL_PERCENTAGE`, alphabetical default, unknown values rejected as a contract-level 400 (same treatment as unknown categories). The `/products` catalog gets a sort control wired to the parameter, preserved in URL state.
- The age-gate declined page gains a "Painoin vahingossa — yritä uudelleen" recovery path that clears the decline state and re-presents the gate. Tone stays warm and non-judgmental.

### Phase 1: meet basic expectations

- The `/products` catalog gains a search input in URL state, and `searchRanked` accepts and applies `category` together with `q` (combined filtering, no silent ignore).
- Product-detail offers render clickable outbound CTAs through the existing `/api/v1/outbound/:offerId` redirect controller, reusing the compare `MerchantLink` pattern ("Katso kaupassa →").
- `POST /api/v1/trip/fill` drops `sessionAuth()` and the entitlement guard — anonymous visitors get allowance fill. Rate limiting and idempotency stay.
- `MAX_BASKET_ITEMS` rises from 10 to 30; the `MAX_TOTAL_COMBINATIONS` guard still bounds the search (422 when exceeded). The basket UI shows an "12/30" progress indicator.
- `CALCULATOR` and `BASKET` rate profiles rise to 60 req/min per IP (Worker middleware and the legacy test-harness parity file). A rejected request renders the friendly "Hetkinen — lasketaan vielä edellistä" message instead of a raw error.

### Phase 2: reduce friction, add intelligence

- New `GET /api/v1/benchmarks/category-averages` returns per-category average €/l from observed catalog data (domestic Alko average vs cross-border webshop average), with as-of timestamp and reliability status. Trip and Event calculators pre-fill from these benchmarks behind an explicit "Käytä keskihintoja / Syötä omat hinnat" toggle, and bureaucratic storage keys (`intermediate_products`, `other_fermented`) render as consumer labels (Väkevöidyt viinit, Lonkerot ja siiderit, …) in both locales.
- Consistent loading ("Lasketaan…" with skeleton), empty ("Emme löytäneet '${query}'…" with broader-search and category links), and error states (human message + retry) across fetching pages.

### Phase 3: build trust and transparency

- Stock availability surfaces as a badge per offer (the data already rides `retail_offers.availability`): out-of-stock offers stay visible for price-history context but are visually de-emphasized and excluded from calculator and fill defaults.
- Each offer carries an Etämyynti (merchant handles Finnish alcohol tax) / Etäosto (buyer declares excise; link to the etäosto guide) badge derived from the seller-country signal. Badges are additive display fields with "general information, not legal advice" framing, empowering rather than warning in tone.

### Phase 4: create delight

- Calculator results show a prominent savings summary ("Tilaamalla Virosta säästät arviolta €X verrattuna Alkon hintaan") built from the existing display-only `alkoBenchmark`.
- A share action on results creates a frozen share snapshot and copies the `/share/[publicId]` link (the sharing backend already exists).
- The trip calculator shows a factual suggestion from the savings snapshots ("Viime kuussa Tallinnasta tilaajat säästivät keskimäärin X% oluissa"), with an honest zero state.
- Mobile refinements: ≥44 px touch targets on category pills and quantity controls, results readable without horizontal scrolling, compare tables collapsing to a card layout on small screens.

## Decisions

- **D1: benchmark, savings, and suggestion surfaces are display-only.** They are additive response fields and read-model listings that never enter a calculation or ranking input, pinned by compliance byte-identity tests following the `warnings-additive-neutrality` / `accuracy-unitprice-input-isolation` precedent. This is both a house guardrail and a neutrality requirement.
- **D2: trip fill goes anonymous but keeps its admission controls.** The CALCULATOR rate limit, the version-aware idempotency cache, and the ferry-offer neutrality contract are unchanged; only the session and entitlement guards drop. This matches the minimal-personal-data principle: the feature needs no identity.
- **D3: sort stays objective and neutral.** Server-side sort orders use only product fields and observed offer aggregates — no commercial signal can enter an ordering, per the neutrality-enforced-in-code guardrail. Unknown sort values are a 400 contract error (matching the existing unknown-category treatment) rather than a silent fallback.
- **D4: no feature flags.** Everything ships enabled (flag system removed 2026-09-07); rollback is `wrangler rollback`, not a flag flip.
- **D5: new copy passes the content lint.** All figures stay factual ("säästät arviolta", "keskimäärin") with as-of context; no advice phrasing ("best deal", "buy now") on any public surface. Status guidance is labeled general information, not legal advice.
- **D6: stock guidance is surfacing, not ingestion work.** `availability` already persists per offer; this change renders it and excludes out-of-stock rows from defaults. No new feed fields, no availability forecasting.

## Non-goals (this change)

- Newsletter popups, cookie walls, dark patterns, and the other anti-patterns listed in the source doc §5 — permanently rejected, not deferred.
- New ingestion fields or feed adapters (stock forecasting, fresh availability sources).
- Entitlement tier changes beyond the trip-fill anonymous access; the FREE-for-all policy stands.
- Real-time stock accuracy guarantees — badges reflect last observed state with existing reliability status and timestamps.
- New analytics tooling for the success-metrics table; the rollout task verifies the existing Analytics Engine counters as the baseline.
- Per-phase delivery: the owner chose one change covering Phases 0–4; groups inside `tasks.md` sequence the work.

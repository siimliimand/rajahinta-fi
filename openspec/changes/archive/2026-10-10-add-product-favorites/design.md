# Design

## Context

Every account-scoped persistence pattern this change needs already exists:
the `priceAlerts` D1 table (account FK with cascade erasure, unique index
as duplicate guard), `D1PriceAlertRepository`, and the
`/api/v1/account/alerts` routes with the
`sessionAuth → requireAccountRateLimit('DEFAULT')` middleware chain. On the
frontend, `/account/saved-baskets` is the page/layout/i18n-namespace
template, `ProductAlertAction` is the product-page action-panel template
(including its signed-out `signin` prompt state), and `AgeGate` is a
proven, well-tested hand-rolled accessible overlay dialog. This change
composes those patterns; it introduces no new machinery.

The read model reuses the alert evaluation's reference series: the
materialized daily price-history summaries, with the same 7-day freshness
lookback. No new data pipeline, no cron, no notification path.

## Goals

- Zero-commitment product saving ("I care about this") with saved-price
  memory so the list shows drift since saving.
- A sign-in funnel that preserves intent: tap ♥ → sign in → favorite done.
- Reusable infrastructure where duplication would otherwise appear
  (`Dialog`, `LoginForm`).

## Non-goals

- Any notification or scheduled evaluation tied to favorites (that is what
  alerts are for; favorites feed alerts, they don't duplicate them).
- TAX_CHANGE rate-version events on favorite rows (explicitly deferred,
  owner decision 2026-10-08).
- Alerts-page product prefill; the alert bridge links to the product
  page's existing `ProductAlertAction` panel.
- Favorite hearts on category/browse listing cards (product page and the
  favorites page are the v1 surfaces).

## Decisions

### D1: Separate `accountFavorites` table, not a new alert kind

A `WATCH` kind on `priceAlerts` would drag every favorite into the
evaluation sweep, force threshold-nullability exceptions through the
kind-aware create matrix, and bolt user-curated UI ordering onto a
notification table. Favorites and alerts differ in semantics (curation vs.
notification), lifecycle (no pause/resume vs. pause/resume), and cost
profile (cheap reads vs. cron evaluation). The alert funnel stays: the
favorites row links to the product's alert panel.

### D2: Schema

`account_favorites` (drizzle `accountFavorites`):

- `id` integer primary key; `account_id` FK → accounts, `onDelete:
  cascade` (GDPR erasure, same guarantee as priceAlerts/savedScenarios);
  `product_id` FK → product_master, no cascade (products are never
  deleted); `saved_price_cents` integer nullable; `created_at` timestamp.
- UNIQUE `(account_id, product_id)` — the duplicate guard is the index,
  surfacing as 409, exactly like the alerts triple.
- `saved_price_cents` nullability is a real state, not "optional for
  later": the product may have no daily summary within the freshness
  window at save time. Data minimization holds — the column has an
  immediate reader (the Δ column).

Migration: `packages/data-platform/src/d1/migrations/0030_account_favorites.sql`
(next number; create table + unique index only — no backfill, no lock
risk).

### D3: Cap 100 at repository and route

A favorites page renders the whole list; 100 keeps it fast and the cap is
a contract-level 400 naming the cap, in the same style as the alerts
unknown-category 400. Enforced in the repository (authoritative) and
translated to a 400 by the route.

### D4: Read model — join, compute, never store deltas

GET joins each row to the product's latest daily summary within the 7-day
freshness lookback (the alert evaluation's window — one shared
definition). Current price and Δ = current − `savedPriceCents` are
computed at read time; storing deltas would rot. Missing/stale summary →
no current price, row still returned.

### D5: Wire contract

`GET/POST/DELETE /api/v1/account/favorites` (DELETE takes
`/:productId`), zod-validated `{ productId }` body, same middleware chain
as alerts (`sessionAuth` registers through the guards table; the
`requireAccountRateLimit('DEFAULT')` bucket key is the authenticated
account). Status codes: 201 create (201 body = the row with read-model
fields), 409 duplicate, 400 over-cap or invalid body, 404 unknown product
or unowned row. Route registration and the guards route-coverage
enumeration are updated together, matching the alerts route's documented
pattern.

### D6: Frontend composition

- `Dialog` (`@/components/ui/Dialog.tsx`): the AgeGate overlay pattern
  extracted — `role="dialog"`, `aria-modal`, initial focus, Tab trap,
  focus restore, Esc close. AgeGate itself is not refactored onto it in
  this change (scope discipline); its tests keep pinning the behavior the
  primitive copies.
- `LoginForm` (`app/[locale]/components/LoginForm.tsx`): the `/login`
  page's form extracted verbatim — `loginAccount()`, uniform 401/429
  failure states — parameterized by an `onSuccess` callback; the page
  passes `router.replace('/account')` and keeps its behavior byte-for-byte.
- `LoginModal` (`app/[locale]/components/LoginModal.tsx`): Dialog +
  LoginForm + register/forgot links (plain navigations).
- `ProductFavoriteAction` (`products/[id]/components/`): existence check
  on mount (favorited? signed-in?) like `ProductAlertAction`; optimistic
  toggle with reconcile on refetch; on 401 the pending intent
  (`productId`) is held in component state, the modal opens, and success
  completes the create.
- `/account/favorites` page: rows with product link, current price (or
  "no fresh price"), Δ since save with direction styling, saved date,
  remove button; account-hub quick-link card alongside saved-baskets and
  alerts; SiteHeader account link.

### D7: i18n

New `Favorites` and `LoginModal` namespaces in
`apps/frontend/src/messages/fi.json` and `en.json`; the
`/account/favorites` entry in `ROUTE_CLIENT_NAMESPACES` pulls
`['Common', 'Favorites', 'ProductSearch', 'ProductSelector']` (the
product-search namespaces serve the row resolution pattern the alerts page
uses). Finnish-first copy: "Suosikit".

## Risks / Trade-offs

- **Modal login vs. WebKit focus quirks** → the Dialog primitive carries
  AgeGate's trap/restore logic, which is already battle-tested against
  this exact class of bug; the primitive gets the same test coverage.
- **Optimistic heart desync** (create fails after the UI flipped) →
  reconcile from the server existence check; the failure path reverts the
  heart and surfaces the inline error state, mirroring
  `ProductAlertAction`'s degradation ladder.
- **Duplicate 409 vs. cap 400 ordering** → cap is checked before the
  duplicate lookup so an over-cap account always gets the cap message.
- **List read amplification** (one summary lookup per row) → bounded by
  the 100 cap and the existing summary table keys; the summary query runs
  per product id in one batched `IN` query, not N queries.

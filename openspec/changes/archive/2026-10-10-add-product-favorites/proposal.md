# Proposal: add-product-favorites

## Why

Users have no way to mark products they care about without committing to an
alert condition. The price-alert watchlist (spec: `price-alerts`) requires a
threshold (PRICE, LANDED_COST, CATEGORY) or a rate-change semantic
(TAX_CHANGE), so "I'm interested in this product" has no zero-commitment
home. Saved baskets are session-scoped snapshots and curated lists are
operator-authored, so neither fills the gap. Favorites turn the site's core
asset — per-product price intelligence — into a passive personal radar: the
saved list shows each product's current price and the drift since saving,
and acts as the natural funnel into threshold alerts.

Decisions locked during exploration (2026-10-08): account-scoped storage;
login required, with a reusable login modal for signed-out taps; a
100-favorites-per-account cap; surfacing TAX_CHANGE rate-version events on
favorite rows is out of scope (future delighter).

## What Changes

- **`accountFavorites` D1 table** (migration `0030_account_favorites`):
  account-scoped, UNIQUE `(account_id, product_id)`, nullable
  `savedPriceCents` captured best-effort from the latest fresh daily price
  summary at insert, cascade delete on the account FK (GDPR erasure, same
  guarantee as `priceAlerts` and `savedScenarios`).
- **`AccountFavoritesRepository`** (data-platform): create (cap + duplicate
  guard + saved-price capture), list with latest-fresh-summary join, delete.
  No scheduled evaluation, no cron — favorites never notify.
- **`/api/v1/account/favorites` routes**: GET/POST/DELETE over the same
  middleware chain as alerts (`sessionAuth` → `requireAccountRateLimit`),
  zod contract, 409 duplicate, 400 over-cap, 404 unknown product or row.
- **Reusable `Dialog` primitive** (`@/components/ui`): extracted from the
  AgeGate overlay's proven accessibility pattern (role=dialog, aria-modal,
  focus trap, focus restore, Esc to close).
- **`LoginForm` extraction**: the `/login` page's form becomes a shared
  component; the page keeps its exact behavior, including
  `router.replace('/account')`.
- **`LoginModal`**: Dialog + LoginForm; a signed-out heart tap opens it, and
  a successful sign-in completes the pending favorite from held component
  state — no re-tap, no URL plumbing. Register/forgot-password links
  navigate to their existing pages.
- **Favorites UI**: `/account/favorites` page (product, current price,
  Δ since save, saved date, remove), account-hub quick-link card, and a
  `ProductFavoriteAction` heart on product pages. The row's alert bridge
  links to the product page's existing alert panel (no alerts-page prefill
  in this change).

## Capabilities

### New Capabilities

- `product-favorites`: account-scoped product favorites with saved-price
  memory, a 100-row cap, sign-in-gated heart actions completed through a
  login modal, and an accessible dialog primitive.

### Modified Capabilities

(none)

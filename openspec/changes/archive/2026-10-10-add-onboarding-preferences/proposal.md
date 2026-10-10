# Proposal: add-onboarding-preferences

## Why

New accounts land cold. The product serves two structurally different journeys
— the ferry traveller who buys within personal allowances and the distance
buyer who pays import VAT, excise, and shipping on delivery — and nothing
today tells these apart. A "good deal" that requires a ferry a user never
takes is noise; the channel question is feasibility segmentation, and taste
categories only scope *within* the feasible set. Post-registration is the
right moment to capture this: the conversion-sensitive moment (signup) is
already behind us, so a skippable interstitial costs nothing.

The captured preferences feed a consent-gated weekly digest of factual price
facts per followed category. The whole feature sits inside the platform's
neutrality doctrine (spec: `neutrality-compliance`): **preferences filter what
an account sees — they never reorder anything.** Digest items are factual
facts from materialized daily summaries, ordered deterministically, with copy
subject to the existing content-policy vocabulary tests.

Decisions locked during exploration (2026-10-09/10): preference-as-filter,
never preference-as-rank; skippable-first onboarding; consent-first digest
(default off, verified addresses only — personalized alcohol email is a
marketing-adjacent surface and stays strictly opt-in); data minimization
(coarse `PRODUCT_CATEGORIES` tags only — no brands, price ceilings, or taste
nuances); v1 stores the channel answer without changing any default routing;
digest content is channel-agnostic in v1.

## What Changes

- **`accountPreferences` D1 table** (migration `0031_account_preferences`):
  one row per account (UNIQUE `account_id`), nullable `channel` enum
  (`TRAVEL` | `DELIVERY` | `BOTH`; null = unanswered), `categoryTags` JSON
  array validated against the shared `PRODUCT_CATEGORIES` constant (same
  repo-layer-validation pattern as CATEGORY alerts — no schema CHECK so the
  constant stays the single definition), `digestEnabled` default false,
  nullable `onboardedAt` (set on quiz completion OR explicit skip), cascade
  delete on the account FK (GDPR erasure, same guarantee as
  `accountFavorites` and `priceAlerts`).
- **`AccountPreferencesRepository`** (data-platform): get, partial put, and
  reset; tag validation at the repository layer.
- **`/api/v1/account/preferences` routes**: GET/PUT/DELETE over the same
  middleware chain as favorites and alerts (`sessionAuth` →
  `requireAccountRateLimit`), zod contract, DELETE resets to the unanswered
  shape.
- **`/onboarding` interstitial**: Q1 channel radio (TRAVEL / DELIVERY / BOTH),
  Q2 category multi-select chips (zero-selected is valid), digest opt-in
  checkbox (unticked), Skip always visible and never dark-patterned; save →
  PUT preferences → `/account`; registration completion reroutes
  `/account` → `/onboarding` (login keeps its existing destination); the page
  doubles as the preferences editor from the account hub.
- **Account-hub card**: onboarding nudge when `onboardedAt` is null (single,
  dismissible — dismissal marks `onboardedAt`; never blocking); preferences
  summary + edit link once set.
- **`digestNotifications` D1 table** (migration `0032_digest_notifications`):
  the digest's crash-safe intent log — `UNIQUE(account_id, digest_week)`,
  intent row written before dispatch, pending-only outcome marking
  (pending → delivered | failed), cascade delete on the account FK.
- **Weekly digest cron** (`preference-digest.ts`): new Monday-morning pattern
  in `wrangler.jsonc` triggers; gated by the `PREFERENCE_DIGEST_ENABLED`
  wrangler var (the established vars rollout pattern, e.g.
  `FRESHNESS_ALERT_EMAIL_TO`); processes only accounts with `digestEnabled`,
  a verified email, and at least one category tag; reads materialized daily
  price summaries only (same 7-day freshness semantics as CATEGORY alert
  evaluation — never the raw R2 observation log); intent → send → mark
  pipeline with week-level idempotency.
- **`buildPreferenceDigestEmail`** (email-worker): FI + EN factual copy —
  per followed category, the category's minimum shelf price and notable new
  low within the window — with locale handling consistent with the existing
  alert email builders and a footer linking to account preferences.
- **Compliance suite** (`tests/compliance/preference-digest-neutrality.test.ts`):
  digest copy passes `checkContent()` (no promotional vocabulary), digest
  ordering is deterministic (category asc, then price asc), and the digest
  path reads no ranking or commercial signal.

## Capabilities

### New Capabilities

- `account-preferences`: account-scoped purchase-channel and category
  preferences captured by a skippable post-registration interstitial, coarse
  by design, with an API contract, an account-hub nudge, and a registration
  routing change.
- `preference-digest`: consent-gated weekly email digest of factual category
  price facts, idempotent per calendar week, crash-safe by intent log,
  factual in content and deterministic in order.

### Modified Capabilities

(none)

# Design: add-onboarding-preferences

## Context

The platform ranks nothing by preference and never will: `tests/compliance/`
enforces that sorting is free of paid/promotional interference and that
generated copy avoids promotional vocabulary. This change adds the first
account-profile data the product has ever stored, so its design burden is
almost entirely about staying on the right side of that boundary — and about
Finnish alcohol-marketing caution for the one surface that leaves the system
(the digest email).

Existing patterns this change deliberately reuses (change
`add-product-favorites` established the account-feature template):
cascade-delete FKs for GDPR erasure, `/api/v1/account/*` route chains
(`sessionAuth` → `requireAccountRateLimit`), repo-layer validation against
shared constants instead of schema CHECKs (CATEGORY alerts), intent-log
delivery with pending-only outcome marking (alert notifications), wrangler
`vars` as rollout gates (`FRESHNESS_ALERT_EMAIL_TO`), and materialized daily
summaries as the only price-fact source (price-alert evaluation).

## Goals / Non-Goals

- **Goals:** capture channel + coarse category tags at registration;
  preference-scoped weekly factual digest, opt-in; erasure-safe storage;
  zero influence on ranking, ordering, or product copy.
- **Non-Goals:** brands/price-ceilings/taste-nuance storage; channel-driven
  default-surface routing (v1 stores the answer only); in-app
  recommendations feed; push notifications; per-channel digest framing;
  behavioral preference inference (saved baskets / trip calculations as
  implicit signals — future delighter).

## Decisions

### D1 — Preference is a filter, never a rank input (neutrality boundary)

Preferences narrow the *candidate set* of facts (which categories appear in a
digest). Within any preference-scoped surface, ordering is the same
deterministic comparator logic the platform already uses — for the digest:
category ascending, then price ascending. No preference field is readable by
ranking, benchmark, or savings modules; the digest computation is a
`core-domain` module that reads price summaries and preference tags only, and
the compliance suite pins both the ordering invariant and the copy vocabulary.
A user's channel answer changes *nothing* about which offers exist or how
they sort.

### D2 — One row per account, coarse fields only (data minimization)

`accountPreferences` is a single row per account (UNIQUE `account_id`), not a
tag table: the field set is fixed and small, and partial updates are
column-scoped. `categoryTags` is a JSON array of `PRODUCT_CATEGORIES` values
— the coarsest useful granularity. No brands, no price ceilings, no free-text
taste answers: an alcohol-preference profile tied to identity is exactly the
data minimization doctrine says not to collect "for later".

### D3 — Consent-first digest, verified addresses only

`digestEnabled` defaults to false, is opt-in via an unticked checkbox, and is
editable forever from `/onboarding` (the preferences editor). The cron skips
accounts whose `accounts.emailVerifiedAt` is null — personalized alcohol
email to unverified addresses is both a deliverability and a
marketing-compliance hazard. The digest copy states price facts (category
minimum, new low, window) and links to the product surfaces; it never uses
promotional framing, and `checkContent()` enforcement is a CI gate, not a
convention.

### D4 — Digest data source: materialized summaries only

The digest reads the same daily-summary buckets CATEGORY alert evaluation
reads, over the same 7-day freshness window. A category with no fresh bucket
is omitted from that account's digest, never reported as zero or stale. No
raw R2 observation reads — a weekly email does not need sub-daily precision,
and sharing the source with alerts keeps one definition of "current".

### D5 — Crash-safe weekly delivery via intent log

`digestNotifications` mirrors the alert-notification contract: the pending
intent row (UNIQUE `(account_id, digest_week)`) is written before any send;
only pending rows transition (pending → delivered | failed) and `marked_at`
is set exactly once. A crashed sweep re-runs into the UNIQUE constraint /
delivered-lookup and suppresses the resend; the one bounded window (crash
after send, before mark) matches the alert pipeline's accepted semantics.
Week key is the ISO week string (e.g. `2026-W41`) computed at sweep start.

### D6 — Skippable-first interstitial; one nudge, never a wall

`onboardedAt` is set by quiz completion *or* explicit skip — skipping is a
first-class outcome, not a failure state. The account-hub nudge appears only
while `onboardedAt` is null, dismisses permanently on dismissal (marks
`onboardedAt`), and never blocks navigation. `/onboarding` remains reachable
from the account hub as the preferences editor, so "change my answers" and
"digest opt-in/out" need no separate settings surface in this change.

### D7 — Tags validated against the shared constant, not the schema

`categoryTags` values are validated at the repository/route layer against
`PRODUCT_CATEGORIES` (the same single-definition pattern CATEGORY alerts
use). A schema CHECK would fork the category vocabulary into two places; the
constant stays the only source of truth. Unknown or empty-string tags reject
with a contract-level 400.

### D8 — Channel is stored, not acted on (v1)

`channel` (`TRAVEL` | `DELIVERY` | `BOTH`, null = unanswered) is captured
because it is the highest-value single bit for future personalization, but v1
acts on it nowhere: no default-surface routing, no digest framing split.
Acting on it is a scoped future change with its own design review — this
keeps the quiz's v1 payoff honest (tags → digest) while banking the answer.

## Risks / Trade-offs

- **[Digest reads as marketing] →** consent gate, verified-address gate,
  factual copy, CI vocabulary test; if compliance posture ever tightens, the
  `PREFERENCE_DIGEST_ENABLED` var is a single-flip kill switch.
- **[Quiz friction despite skip] →** interstitial sits after registration,
  skip is one tap, nudge is dismissible; skip rate is observable via
  `onboardedAt` null-ness on accounts that reach `/account`.
- **[Weekly cron cold-start] →** empty digests (no fresh buckets in any
  followed category) are not sent at all — no "nothing happened this week"
  emails, no intent row written for an empty digest.

## Migration Plan

Two additive D1 migrations (`0031_account_preferences`,
`0032_digest_notifications`), both nullable-column-safe against existing
rows (no backfill needed: no existing account has preferences). The new cron
pattern and var land together in `wrangler.jsonc`; the var defaults to unset
= digest disabled in every environment until explicitly enabled.

## Open Questions

- Digest send-time locale: accounts carry no locale column; v1 follows the
  existing alert-email locale handling. A per-account locale is a future
  field, deliberately not added now (minimization).

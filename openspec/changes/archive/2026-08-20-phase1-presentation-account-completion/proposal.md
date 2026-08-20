# Phase 1 Presentation & Account Completion

## Why

The core domain, data platform, and calculation engine are complete and well-tested (734 tests across six packages). A Phase 1 audit against `docs/tasks.md` found that all remaining code gaps are confined to the presentation layer and the account/GDPR subsystem. Five tasks are genuinely incomplete, and five tasks are marked `[ ]` in `docs/tasks.md` even though the code is already implemented.

The five genuine gaps:

1. **Controlled-vocabulary enforcement is not wired into CI (T1.49).** `content-policy.ts` exists as a library with a forbidden-adjective list and unit tests, but nothing scans generated copy at build time. The implementation plan (Section 9) requires enforcement "via a lint/review step in the content pipeline" — no such step exists.
2. **Outbound merchant links record no analytics (T1.50).** `MerchantLink.tsx` renders plain `rel="noopener noreferrer"` links with an unused `onClick` prop. The task requires recording click-through counts; nothing stores them.
3. **The account system is non-functional from a user's perspective (T1.60).** The backend `AccountService`/`AccountController` fully expose baskets, history, subscription, and export, but every frontend sign-in button is disabled with a "coming soon" tooltip. Users cannot establish a session, save baskets, view history, or export data.
4. **Retention has no scheduled trigger (T1.63).** `AccountRetentionService` implements the correct 6/12/24-month policies, but no recurring job invokes its purge/anonymize methods.
5. **Data export has no UI (T1.64).** The backend `GET /api/v1/account/export` endpoint exists, but the account page shows a "Coming soon" card and no way to trigger a download.

The five checklist inaccuracies (code exists, checkbox unchecked): the calculator UI (T1.45), the calculation explanation page (T1.46), comparison views (T1.47), data-freshness indicators (T1.48), and the pluggable identity-verification module (T1.59).

## What Changes

1. Add a content-policy lint step that scans frontend source for forbidden adjectives and wire it into the CI pipeline as a gating job.
2. Add click-through recording for outbound merchant links (counts only — no purchase or commission tracking) via a backend endpoint and frontend wiring.
3. Make the minimal account system functional: anonymous session establishment, account creation page, saved-baskets UI, calculation-history recording/display, and data-export download.
4. Schedule the retention purge/anonymize jobs on a recurring basis.
5. Surface the existing data-export endpoint through the account UI.
6. Resync `docs/tasks.md` to check off the five already-implemented tasks.

## Capabilities

### New Capabilities

None — this change completes existing Phase 1 capabilities; it introduces no new domain.

### Modified Capabilities

- `web-application`: controlled-vocabulary enforcement becomes a CI-gated lint step; merchant links record click-through counts.
- `accounts-age-gate`: the minimal account system becomes reachable end-to-end (session, baskets, history, export); retention runs on a schedule.
- `application-api`: new click-analytics and calculation-history endpoints.

## Impact

- Completes the presentation-layer and account/GDPR gaps without touching tax math, classification rules, ranking neutrality, or the declaration assistant's read-only contract.
- Adds a new backend endpoint (`POST /api/v1/analytics/click`) and one account endpoint (`POST /api/v1/account/history`).
- Adds a CI job to the existing `ci.yml` DAG (no new infrastructure).
- The account system remains anonymous-by-default: session identity is a client-generated UUID with no email, date-of-birth, or identity-document collection.
- Retention scheduling reuses the existing `@nestjs/schedule` cron infrastructure already used for price/transport/tax jobs.

## Human-Process Tasks

None new. The pre-launch legal review (Phase 1 tasks T1.65–T1.69) remains the external gate that must complete before the launch flag is turned on.

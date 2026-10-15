# Tax change calendar (veromuutokset)

## Why

2026 gives the site concrete recurring content hooks: the Finnish wine/cider manufacturing excise rose ~9% on 1.1.2026, all drinks above 2.8 vol% are now permanently tied to HICP (+1.4% in 2026), Alko prices rose ~1% on average (0.75 l wine bottle +0.46 €, 1 l strong alcoholic drink +0.45 €), Verohallinto's 2026 table prices wine 8–15% at 504.97 snt/l and ethyl alcohol above 10% at 56.28 snt/cl, and Estonia raised its alcohol excise 10% in January 2026 (0.5 l beer +~10 snt, a spirits bottle +~30 snt) — sharpening the Tallinn-vs-Helsinki comparison this platform exists for. The rhythm itself is predictable: Alko changes prices twice a year, Verohallinto publishes the next year's table at year end, and from 2027 the rates are confirmed by government decision. Today the site announces changes only after they are confirmed (rate-change blog drafts created at the dataset gate) — no surface gives a user a recurring reason to come back. A tax-change calendar turns annual facts into a repeat-visit habit.

## What Changes

- **New D1 table `calendarEvents`**: closed event-type vocabulary (`FI_EXCISE_CHANGE | EE_EXCISE_CHANGE | ALKO_PRICE_LIST | TAX_TABLE_PUBLICATION | RATE_DECISION`), status `CONFIRMED | EXPECTED`, exact `occurrenceDate` for confirmed events plus an `expectedWindow` for rhythm events, mandatory official `sourceUrl`, and FI/EN title + summary text.
- **2026 event set seeded** after facts are verified against official sources (vero.fi 2026 alcohol excise table, alko.fi price-list announcements, Estonian Tax and Customs Board): FI excise change, EE excise change, two Alko price-list updates, Verohallinto 2027 table publication, and the 2027 rate-decision window.
- **Core-domain `calendar` module**: deterministic ordering (date → type → id), next-event selection where a confirmed day-precision event beats an expected window at the same period, and a versioned FI/EN rhythm-disclaimer constant pair (structural wording, never composed at request time — same discipline as the what-if disclaimer).
- **Public API**: `GET /api/v1/calendar/events?year=` and `GET /api/v1/calendar/next`, age-gated and rate-limited per house conventions, unified error envelope.
- **Calendar page** `/veromuutokset` (en: `/tax-changes`): year timeline grouped by month, event cards with status badges (vahvistettu / vuosirytmi), official-source links, editorial context copy on the annual rhythm, and cross-links to the what-if simulator and rate-change blog posts. Included in the sitemap.
- **Homepage next-change widget**: "Seuraava hintamuutos" — next event title, days-until (or window label for EXPECTED events), link to the calendar page.
- **Ops maintenance path**: an audited calendar-events section in the ops console (list, create, update) behind OpsAccessGuard, so 2027 rows land without a code change.

## Capabilities

### New Capabilities
- `tax-change-calendar`: calendar events as closed-vocabulary sourced data; honest separation of confirmed changes from annual rhythm; public deterministic listing and next-event API; the calendar page and homepage next-change widget; the audited ops maintenance path.

### Modified Capabilities

## Impact

- `packages/data-platform`: new `calendarEvents` table in `schema.ts`, committed migration, repository, 2026 seed.
- `packages/core-domain`: new `calendar` module (pure ordering/selection/disclaimer logic).
- `apps/api-worker`: new public Hono routes under `/api/v1/calendar/*`.
- `apps/frontend`: new `[locale]/veromuutokset` and `[locale]/tax-changes` routes, homepage widget, ops console section, fi/en message files, sitemap entry.
- No changes to excise math, ranking, landed-cost computation, or existing alert semantics.

## Non-goals

- A geographic map view (Tallinn–Helsinki border visual) — V2 candidate.
- Auto-derivation of FI calendar events from rate-dataset confirmations — follow-up; V1 uses seed + ops CRUD.
- Alert subscriptions tied to calendar events (TAX_CHANGE alerts remain product-scoped).
- Any change to excise formulas, ranking, or commercial inputs.

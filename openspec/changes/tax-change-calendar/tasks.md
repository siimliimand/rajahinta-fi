# Tasks

## 1. Facts and schema

- [x] 1.1 Verify the 2026 calendar facts against official sources — vero.fi 2026 alcohol excise table, alko.fi price-list announcements, Estonian Tax and Customs Board — and record exact dates, figures, and source URLs in a verified-facts note; Alko events without a dated official announcement are recorded as expected windows. Verify: the note lists every planned seed row's date/figure with a citable URL <!-- agent: platform-engineer.fast, depends_on: [], touches: [openspec/changes/tax-change-calendar/verified-facts.md] -->
- [ ] 1.2 Add the `calendarEvents` table to the Drizzle schema (closed eventType and status vocabularies, nullable occurrenceDate, expectedWindow for EXPECTED rows, FI/EN title+summary NOT NULL, sourceUrl NOT NULL, year) with a committed migration and persistence-boundary validation. Verify: the migration applies on a fresh D1 database and the validator rejects an unknown type, a missing source URL, and missing locale text with contract-level errors <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/schema.ts, packages/data-platform/src/drizzle/**] -->
- [ ] 1.3 Seed the 2026 event set from the verified-facts note (FI excise change, EE excise change, two Alko price-list events, Verohallinto 2027 table publication, 2027 rate-decision window), every row citing its official source URL. Verify: the seed is idempotent on rerun and an integration read returns the six events with their sources <!-- agent: platform-engineer.fast, depends_on: [1.1, 1.2], touches: [packages/data-platform/src/seed/calendar-events.seed.ts] -->

## 2. Core-domain calendar module

- [ ] 2.1 Add the pure calendar module: closed event-type set, deterministic ordering (period → type → id), next-event selection preferring CONFIRMED day precision over an EXPECTED window in the same period, and the versioned FI/EN rhythm-disclaimer constant pair selected by explicit language (defaulting to `'fi'`). Verify: unit tests cover ordering determinism, next-event precedence, disclaimer selection for fi/en/default, and the absence of forecast wording in the constants <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/core-domain/src/calendar/**] -->

## 3. API

- [ ] 3.1 Drizzle calendar-event repository behind the domain port: year-range reads and the next-event query, registered in the data-platform module. Verify: repository tests cover year filtering, deterministic order, and next-event precedence against seeded rows <!-- agent: platform-engineer.build, depends_on: [1.2], touches: [packages/data-platform/src/repositories/calendar-event.repository.ts, packages/data-platform/src/data-platform.module.ts] -->
- [ ] 3.2 Public Hono routes GET /api/v1/calendar/events?year= and GET /api/v1/calendar/next with zod DTOs, age gate, rate limiting, and the unified error envelope. Verify: route tests assert deterministic repeated responses, the next-event payload includes status, a bad query is rejected with a contract-level error, and an unconfirmed client hits the age-gate contract <!-- agent: platform-engineer.build, depends_on: [2.1, 3.1], touches: [apps/api-worker/src/routes/**] -->

## 4. Frontend surfaces

- [ ] 4.1 Calendar page: `[locale]/veromuutokset` (fi) and `[locale]/tax-changes` (en) — year timeline grouped by month/window, event cards with status badges (vahvistettu / vuosirytmi), official-source links, editorial rhythm copy, cross-links to the what-if simulator and rate-change blog posts. Verify: component test renders the 2026 seeded set grouped by month with badge and source per card, and the en route renders the English variant <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/frontend/src/app/[locale]/veromuutokset/**, apps/frontend/src/app/[locale]/tax-changes/**] -->
- [ ] 4.2 Homepage next-change widget: next event title, days-until for CONFIRMED, window label plus disclaimer for EXPECTED, link to the calendar page. Verify: component tests cover both widget states and assert no day countdown renders for an EXPECTED event <!-- agent: platform-engineer.build, depends_on: [3.2], touches: [apps/frontend/src/app/[locale]/page.tsx, apps/frontend/src/components/calendar/**] -->
- [ ] 4.3 i18n keys (fi/en) for the calendar page and widget, including the structural rhythm disclaimer mirroring the core-domain constants. Verify: content lint passes and a locale test asserts both locales resolve every key the two surfaces use <!-- agent: platform-engineer.fast, depends_on: [4.1, 4.2], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] -->
- [ ] 4.4 Sitemap inclusion for the new routes and remaining component tests (EXPECTED disclaimer presence, deterministic card order). Verify: the sitemap test lists /veromuutokset and the en variant, and the frontend suite passes <!-- agent: platform-engineer.build, depends_on: [4.1, 4.3], touches: [apps/frontend/src/sitemap.ts, apps/frontend/src/app/[locale]/veromuutokset/**] -->

## 5. Ops maintenance path

- [ ] 5.1 Ops console calendar-events section (list, create, update) behind the ops access guard with audit events, reusing the persistence-boundary vocabulary validation; no delete. Verify: ops route tests assert an unauthenticated create is rejected by the guard, a created 2027 event appears on the public year listing according to its status, and an audit row exists <!-- agent: platform-engineer.build, depends_on: [3.1], touches: [apps/frontend/src/app/[locale]/ops/**, apps/api-worker/src/routes/**] -->

## 6. Integration verification

- [ ] 6.1 Run typecheck, eslint, and the affected suites (core-domain calendar, data-platform, api-worker routes, frontend). Verify: all green; record results in the task note <!-- agent: platform-engineer.fast, depends_on: [4.4, 5.1], touches: [] -->
- [ ] 6.2 Staging deploy + smoke: /veromuutokset renders the 2026 timeline age-gated, /api/v1/calendar/next returns the seeded next event, the homepage widget renders, and an ops create is audited. Verify: the deploy workflow succeeds and the smoke matrix is recorded in the task note <!-- agent: devops-engineer.fast, depends_on: [6.1], touches: [] -->

# Tasks

## 1. API

- [x] 1.1 Category listing in `savings.routes.ts`: filter to negative gaps only, exclude self-paired rows (offer merchant == reference merchant on the same product), and expose the `hasFavourable` marker alongside the existing coverage counts and as-of date; `/top` and best-per-merchant routes unchanged <!-- agent: platform-engineer.build, depends_on: [], touches: [apps/api-worker/src/routes/savings.routes.ts] --> (7e976b3; self-pair = bestMerchant !== 'alko' since the record's reference is always the Alko reference; hasFavourable computed before the limit clamp)
- [x] 1.2 Route tests: a zero-negative-gap category returns empty rows + `hasFavourable: false` + coverage; a self-paired fixture row (Alko offer vs its own reference) is excluded; multi-row category ordering stays byte-stable; `/top` contract unchanged <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/__tests__/savings.routes.test.ts] --> (0a7dc2c; 5 new tests + minimal conformance edits to 6 pre-existing fixtures that pinned the positive-gap contract; local vitest unrunnable — host node:sqlite lacks FTS5, collection fails with 'no such module: fts5' exactly as before; tsc + eslint clean; CI is the runtime arbiter)

## 2. Page

- [x] 2.1 Zero-negative state on `/savings`: explicit "ei tällä hetkellä kannattavia tuonteja" state with as-of date + coverage counts; ordering statement stays; positive-gap rows never render as savings rows <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/frontend/src/app/[locale]/savings/page.tsx, apps/frontend/src/app/[locale]/savings/components/] --> (109338f; zero state keeps the coverage header + as-of visible above the EmptyState; defensive `gapCents < 0` client filter drives both branches)
- [x] 2.2 i18n keys (fi/en) for the no-favourable-imports state <!-- agent: platform-engineer.fast, depends_on: [2.1], touches: [apps/frontend/src/messages/fi.json, apps/frontend/src/messages/en.json] --> (absorbed into the 2.1 worker — SavingsPage.noFavourableTitle/noFavourableBody landed with the component change; old emptyTitle/emptyBody keys left unreferenced in the catalogs)
- [x] 2.3 Component tests: zero-negative category renders the honest state; a category with negative-gap rows renders rows as before; compliance isolation assertions untouched <!-- agent: platform-engineer.build, depends_on: [2.1, 2.2], touches: [apps/frontend/src/app/[locale]/savings/savings-page.test.tsx] --> (f3975dd, committed by the task worker; 3 old pins repinned to the honest contract with corrected fixtures, +1 defensive-filter test; compliance/metadata tests unmodified; suite 1577/1577, tsc + eslint clean)

## 3. Verification

- [ ] 3.1 Run typecheck, eslint, and the api-worker + frontend suites across touched paths <!-- agent: platform-engineer.fast, depends_on: [1.2, 2.3], touches: [] -->
- [ ] 3.2 Staging/live spot-check: beer (zero negative gaps live) renders the honest state; `/savings/top` still shows the 3 favourable rows with `importFavourable: 3` <!-- agent: devops-engineer.fast, depends_on: [3.1], touches: [] -->

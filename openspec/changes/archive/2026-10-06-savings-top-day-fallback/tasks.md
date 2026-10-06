# Tasks: savings-top-day-fallback

## 1. Repository + route

- [x] 1.1 Add a recent-days read to `D1SavingsSnapshotRepository` (e.g. `listRecentAsOfDays(limit)` returning distinct `as_of` values DESC and/or `findDay(asOf)`), mirroring the file's existing SQL style (prepared statements, `SavingsSnapshotRecord` mapping). Verify: the repo's D1-harness tests stay green. <!-- agent: platform-engineer.build, depends_on: [], touches: [packages/data-platform/src/repositories/d1/savings-snapshot.repository.ts] -->
- [x] 1.2 Implement the fallback in `getSavingsTop`: collect the most recent distinct snapshot days within a named `TOP_LOOKBACK_DAYS = 3` constant; select the latest day with ≥1 eligible row (negative gap + non-null Alko reference + registry-resolvable name); return that day's rows, its as-of, and coverage counts computed over it (evaluated = registry count; importFavourable = eligible on the selected day; listed = returned). When no day in the lookback has an eligible row: empty rows, the maximal day's as-of (null when no snapshot exists at all), zero import-favourable coverage. Unit tests: latest-day-eligible short-circuits (no fallback); latest empty + yesterday eligible → yesterday's rows/as-of/coverage; only a 3-days-back day eligible → returned; nothing eligible in lookback → honest empty with maximal as-of. Verify: `pnpm --filter api-worker exec vitest run src/routes/__tests__` green (node ≥ 24). <!-- agent: platform-engineer.build, depends_on: [1.1], touches: [apps/api-worker/src/routes/savings.routes.ts, apps/api-worker/src/routes/__tests__/savings-top.routes.test.ts] -->

## 2. Verification

- [x] 2.1 Lead-side verification: full api-worker route suites, frontend suites, compliance suite, workspace typecheck, lint; e2e homepage journeys re-run (populated + pending) if the harness is available. Verify: all green; no homepage change required. <!-- agent: , depends_on: [1.2], touches: [] -->

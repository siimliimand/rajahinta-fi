# Proposal: savings-top-day-fallback

## Why

The homepage live gap hero rendered its pending state on 2026-10-06 even
though the previous day's snapshot holds three real import-favourable
wins (queried live in production: products 3520/3550/3654 via kippis,
best −€33.65). Cause: the top-N read consumes only the maximal snapshot
day (`findLatestDay()`), and the daily materialization walk is
id-ascending over ~16–20 h — so for most of every day the "latest day"
is a thin partial prefix (241 rows at diagnosis time, zero
import-favourable). The per-category listing never looks empty (it
shows all rows, losses included); the top-N's negative-only filter
makes the partial-day emptiness visible as a daylong pending hero.

## What Changes

- **Bounded day fallback in `GET /api/v1/savings/top`** — when the
  latest snapshot day yields zero eligible rows, the read walks back
  over the most recent distinct snapshot days (bounded to 3 lookback
  days, matching the homepage's own staleness cutoff) and returns the
  first day that has eligible rows, with **that day's as-of and
  coverage counts**. Empty list only when no eligible row exists
  within the lookback (then the latest examined day's as-of carries,
  zero counts). The as-of response field keeps the honesty contract:
  the homepage renders whatever date is returned under its existing
  3-day freshness gate — no homepage change.
- Repository support: a concrete recent-days read on
  `D1SavingsSnapshotRepository` (the route consumes the concrete D1
  class; no port/abstract ripple).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `savings-discovery`: MODIFIED requirement *Public deterministic
  cross-category top-N listing* — selection reads the latest snapshot
  day **with eligible rows within a fixed 3-day lookback**; the
  response carries that day's as-of; empty only when no eligible row
  exists within the lookback.

## Impact

- `packages/data-platform/src/repositories/d1/savings-snapshot.repository.ts`
  (+ its D1-harness test if one exists) — recent-days read.
- `apps/api-worker/src/routes/savings.routes.ts` +
  `__tests__/savings-top.routes.test.ts` — fallback loop + scenarios.
- Read-only, display-only: no computation surface touched; compliance
  isolation unaffected. Known follow-up (separate concern): the
  production savings walk itself is stalled (cursor frozen at 6771
  since 2026-10-05 14:07 UTC) — the fallback decouples the hero from
  that stall but does not fix it.

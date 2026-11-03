# Task 2.2 verification — deploy portion (2026-11-03)

Deploy + immediate smoke executed 2026-11-03T10:34–10:45Z. The 03:30Z nightly-tick
verification is recorded as a protocol at the bottom for a follow-up session
(the tick fires 2026-11-04T03:30Z).

## Deploys

Branch `feature/nightly-sweep-repair` @ `829174be` pushed to origin.

| Environment | Workflow run | Result | API Worker version |
|---|---|---|---|
| Staging | [`41620479935`](https://github.com/siimliimand/rajahinta-fi/actions/runs/41620479935) | ✓ all 15 steps (2m14s) | `c15a5451-d5ac-4768-91ac-7859e1019da7` (2026-11-03T10:36:07Z) |
| Production | [`41620894829`](https://github.com/siimliimand/rajahinta-fi/actions/runs/41620894829) | ✓ every step (deploy job `125866037228` 2m4s + rollback-availability job `125867004793` 4s) | `d9174112-7f03-4548-bb69-b5b8ac0369cc` (2026-11-03T10:38:44Z) |

Production step outcomes — no failures, no skips beyond the gated-input step:

- Require confirmation: `-` (workflow_dispatch input `confirm_deploy=yes` provided; gate satisfied)
- Set up job / checkout / pnpm / node / install deps: ✓
- Apply D1 migrations (production): ✓
- **Deploy API Worker (production): ✓** — new Current Version ID `d9174112-7f03-4548-bb69-b5b8ac0369cc`
- Deploy email Worker (production): ✓
- Build frontend (OpenNext): ✓ (PR #154 gate fix holding — previously failing step now green)
- Deploy frontend Worker (production): ✓
- Health gate — production readiness: ✓
- Rollback availability (wrangler rollback): ✓ (separate job)

Only annotations were pre-existing runner notices (Node 20 → 24 deprecation,
ubuntu-latest migration) — non-failing, unrelated to this change.

## Smoke results (post-deploy, 2026-11-03T10:37–10:41Z)

Staging (`https://rajahinta-api-staging.siim-liimand.workers.dev`):

- `GET /api/v1/health` → **200** `{"status":"ok"}`
- `GET /api/v1/health/ready` → **200** `d1: up (115ms)`, `durableObjects: up (125ms)`

Production (`https://api.rajahinta.fi`):

- `GET /api/v1/health` → **200** `{"status":"ok"}`
- `GET /api/v1/health/ready` → **200** `d1: up (123ms)`, `durableObjects: up (132ms)`
- `GET /api/v1/products?limit=1` with `x-age-confirmed` header → **200**, items returned

## Prod D1 "before" state (read-only, 2026-11-03T~10:42Z)

Database `rajahinta-api-production`:

- `SELECT COUNT(*) FROM calculation_records` → **498,528**
- Past window (`calculated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`) → **65,859**

Baseline 64,659 (2026-11-03 measure at task creation) → 65,859 now; consistent with
the ~1.2k same-day growth before the first sweep tick. **65,859 is the before-value
for the tick check below.**

## Tick-verification protocol — 2026-11-04T03:30Z (follow-up session)

After the nightly cron fires (~03:30Z), verify:

**(a) Workers Logs — sweep ran clean.** Query telemetry on worker
`rajahinta-api-production`, `eventType: scheduled`, window `2026-11-04T03:28Z` →
`03:40Z`. Expected lines:

- `Cron handler "retention-sweep" complete`
- `Retention sweep finished: pruned anonymous calculation_records=…`

Must show **NO** `process is not defined` error (the 2.1 fix under test).

**(b) Prod D1 re-count — drain happened.** Re-run the past-window count:

```sql
SELECT COUNT(*) FROM calculation_records
WHERE calculated_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days');
```

Expect the count dropping from **65,859** toward **0**. The sweep loop drains to
exhaustion in a single pass (bounded per statement, unbounded loop), so the count
should land at/near 0 in this one tick. Record the actual drain duration from the
log timestamps (first pruned-batch line → `Retention sweep finished` line) in the
change notes, updating this file and `tasks.md` 2.2.

**(c) Per-night idempotency.** If Workers Logs or the count shows an interrupted
drain (non-zero remainder, no error), that is acceptable by design: the cutoff-based
loop resumes and finishes the remainder on the next night's tick. Only flag a
blocker if the sweep errors (`process is not defined` or other) or the count does
not decrease at all.

## Status

- Deploy portion: **complete** (this file).
- Tick portion: **pending** — protocol above, execution after 2026-11-04T03:30Z.

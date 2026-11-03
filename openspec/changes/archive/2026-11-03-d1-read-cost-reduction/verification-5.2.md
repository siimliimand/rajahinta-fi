# Task 5.2 verification — staging deploy + smoke + retention dry-run

Date: 2026-10-25 · Branch: `feature/d1-read-cost-reduction` · Scope: staging only
(`rajahinta-api-staging`, D1 `rajahinta-api-staging`). Production untouched.

## Staging deploy

GitHub Actions run
[40204232448](https://github.com/siimliimand/rajahinta-fi/actions/runs/40204232448),
`workflow_dispatch` on this branch.

| Workflow step | Outcome |
|---|---|
| Apply D1 migrations (staging) | ✓ (0041 re-apply = recorded no-op) |
| Seed staging D1 | ✓ |
| Deploy API Worker (staging) | ✓ active version `94a19ed9` (100%), 2026-10-25T14:53:10Z |
| Deploy email Worker (staging) | ✓ |
| Build frontend (OpenNext) | ✗ — pre-existing tooling gate, see below |
| Deploy frontend Worker / Health gate | skipped (frontend build failed) |

The frontend failure is **not caused by this change**: the branch touches no
dependency files, and `pnpm-lock.yaml` is identical to `origin/master`
(`@opennextjs/cloudflare@1.20.4` + `next@15.5.24`); `opennextjs-cloudflare`
now hard-refuses Next.js 15.5.24 ("not supported by the Next.js team"). The
last green master run (2026-10-19, run 39303682178) predates the gate. Master
HEAD would fail the same way. Because the workflow's own health-gate step was
skipped, the readiness smoke below was performed manually against the freshly
deployed API Worker — the only artifact this change affects.

## Post-deploy smoke (staging API Worker)

Base: `https://rajahinta-api-staging.siim-liimand.workers.dev`

| Check | Result |
|---|---|
| `GET /api/v1/health/ready` | 200 — `status: ok`, `d1: up (393 ms)`, `durableObjects: up (565 ms)` |
| `GET /api/v1/health` (liveness) | 200 — `status: ok` |
| `GET /api/v1/products?limit=1` | 200 — normal payload, `total: 9703` (universe unchanged) |
| `GET /api/v1/products/1532` | 200 — full detail + offers payload |

Age-gated reads sent the `x-age-confirmed` header (the documented Phase-1
confirmation path); without it the endpoints correctly return 403
`AGE_GATE_REQUIRED`.

## Retention DRY-RUN report (owner-gate input — read-only, zero deletions)

Staging crons are disabled (2026-10-14 override, committed `crons: []`) and
the handler is dry-run-by-default in code, so the report was produced by
running the handler's exact read-only candidate selection against staging D1
(`wrangler d1 execute … --remote --json`, `served_by_primary: true`,
`rows_written: 0`, `changed_db: false`).

The selection mirrors `SELECT_SUPERSEDED_IDS_SQL`
(`apps/api-worker/src/cron/retail-offers-retention.ts`): superseded = the
anti-join form of rn ≥ 2 under (observed_at DESC, id DESC) per
(merchant, product_id), AND `observed_at < cutoff`. Note: the cutoff uses the
ISO-8601 `Z` format the handler binds (from `.toISOString()`), not
`datetime('now','-30 days')` — `retail_offers.observed_at` is stored as
`strftime('%Y-%m-%dT%H:%M:%fZ','now')`, so the string comparison must match
the handler's format.

| Metric (staging, cutoff `2026-09-25T14:53:58.261Z`) | Rows |
|---|---|
| Total `retail_offers` rows | 120 673 |
| Deletion candidates (superseded AND past 30-day window) | 84 352 |
| Superseded within window (kept by design) | 24 945 |
| Deterministic-latest per (merchant, product_id) — must survive | 11 376 |
| …of which themselves past the window, surviving via anti-join rule | 2 855 |

Partition check: 84 352 + 24 945 + 11 376 = 120 673 ✓.
**Deleted: 0** — dry-run only; staging deletion happens by nobody in this task.

## EXPLAIN QUERY PLAN pins (against staging data)

| Query | Plan |
|---|---|
| `SELECT id FROM product_master WHERE ean='x'` | `SEARCH product_master USING COVERING INDEX product_master_ean_idx (ean=?)` |
| `SELECT id FROM product_master WHERE name=? AND brand=? AND container_type=? AND unit_volume=?` | `SEARCH product_master USING COVERING INDEX product_master_name_brand_container_volume_idx (name=? AND brand=? AND container_type=? AND unit_volume=?)` |
| `SELECT COUNT(DISTINCT product_id) FROM retail_offers INDEXED BY retail_offers_observed_at_product_idx WHERE observed_at>='2026-10-19'` | `SEARCH retail_offers USING COVERING INDEX retail_offers_observed_at_product_idx (observed_at>?)` (+ `USE TEMP B-TREE FOR count(DISTINCT)`, expected) |

All three pin `SEARCH` on the migration-0041 indexes; no full-table `SCAN`
remains on the changed paths.

## Blockers / follow-ups

- Frontend staging deploy is blocked repo-wide by the
  `opennextjs-cloudflare@1.20.4` Next.js-15.5.24 version gate (pre-existing on
  master; unrelated to this change). Needs a repo-level fix (bump
  `@opennextjs/cloudflare` or pass `--dangerouslyUseUnsupportedNextVersion`)
  — out of scope for task 5.2, which exercises the API Worker only.
- The dry-run candidate count above is the owner-gate input; the live-mode
  flip at the registration site remains the owner decision (unchanged).

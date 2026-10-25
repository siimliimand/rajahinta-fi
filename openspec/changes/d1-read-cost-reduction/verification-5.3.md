# Task 5.3 verification — production rollout (owner-approved, migration + deploy + dry-run)

Date: 2026-10-25 · Branch: `feature/d1-read-cost-reduction` · Scope: production
(D1 `rajahinta-api-production` `f8f67277-5046-46fc-9144-4342ab7af003`, Worker
`rajahinta-api-production` at `api.rajahinta.fi`). Owner approved the migration,
worker deploy, and dry-run report. **Retention remains DRY-RUN in production.**

## Migration 0041 → production

`wrangler d1 migrations apply rajahinta-api-production --env production --remote`
(non-destructive, `CREATE INDEX IF NOT EXISTS` × 3) — ✅
`0041_product_read_indexes.sql` applied, 4 commands, 562.99 ms. The workflow's
own migrate step re-ran it afterward as a recorded no-op.

Indexes present on `product_master` / `retail_offers` after the apply
(`sqlite_master`):

| Index | Table |
|---|---|
| `product_master_category_idx` (pre-existing) | `product_master` |
| **`product_master_ean_idx`** (0041) | `product_master` |
| **`product_master_name_brand_container_volume_idx`** (0041) | `product_master` |
| `retail_offers_merchant_product_id_observed_at_idx` (pre-existing) | `retail_offers` |
| **`retail_offers_observed_at_product_idx`** (0041) | `retail_offers` |
| `retail_offers_product_merchant_id_idx` (pre-existing) | `retail_offers` |
| `retail_offers_reliability_status_observed_at_idx` (pre-existing) | `retail_offers` |

## Deploy (GitHub Actions run 40214778835)

[`workflow_dispatch`](https://github.com/siimliimand/rajahinta-fi/actions/runs/40214778835)
on this branch, `confirm_deploy=yes` — the workflow is gated manual-dispatch
only (no push trigger), so no merge was needed.

| Workflow step | Outcome |
|---|---|
| Apply D1 migrations (production) | ✓ (0041 re-apply = recorded no-op) |
| **Deploy API Worker (production)** | **✓** — log: `Uploaded rajahinta-api-production (3.22 sec)` → `Deployed rajahinta-api-production triggers (3.15 sec)` → `Current Version ID: 9208b7a8-5f2f-4e05-ad60-0960d0085d03` |
| Deploy email Worker (production) | ✓ |
| Build frontend (OpenNext) | ✗ — pre-existing `opennextjs-cloudflare@1.20.4` / Next.js 15.5.24 version gate, identical on master and all branches (documented in verification-5.2); unrelated to this change |
| Deploy frontend Worker / Health gate | skipped (frontend build failed) |

The job's overall `failure` conclusion comes solely from the frontend gate;
every Worker artifact this change affects deployed successfully.

Active deployment confirmed changed via `wrangler deployments list --env production`:
Version `9208b7a8-5f2f-4e05-ad60-0960d0085d03` (100%), created
2026-10-25T17:06:10.100Z, deployment 2026-10-25T17:06:11.388Z — superseding the
previous 2026-10-19 deployment. Instant rollback remains available
(`wrangler rollback --env production`).

## "Before" read baseline (prod D1, GraphQL `d1QueriesAdaptiveGroups`)

Daily `sum.rowsRead` for this database, captured **before** the worker deploy
(2026-10-25T17:04Z), filter `databaseId = f8f67277-…`, `datetimeHour ≥
2026-10-24T00:00:00Z`:

| Day | rowsRead | Note |
|---|---|---|
| 2026-10-24 (full day) | 206,733,119 | full day on the pre-0041 worker |
| 2026-10-25 (partial → 17:04Z) | 82,453,251 | deploy at 17:06Z ends this series |

Measured full-day baseline is ~207M reads/day (higher than the ~165M/day
earlier estimate — the expectation of a steep drop is conservative).

## Post-deploy smoke (production, https://api.rajahinta.fi)

| Check | Result |
|---|---|
| `GET /api/v1/health` (liveness) | 200 — `{"status":"ok"}` |
| `GET /api/v1/health/ready` (readiness) | 200 — `status: ok`, `d1: up (125 ms)`, `durableObjects: up (705 ms)` |
| `GET /api/v1/products?limit=1` | 200 — `total: 22291`, 1 item (production universe; prod `product_master` = 23 489 rows — the ~9 700 figure quoted elsewhere is the staging seed universe). Without the `x-age-confirmed` header the endpoint correctly answers 403 `AGE_GATE_REQUIRED` (documented Phase-1 age-gate behavior) |

## Retention DRY-RUN report — OWNER REVIEW ARTIFACT (zero writes)

**Retention is DRY-RUN in production.** The handler's code default is
report-only (`mode ?? 'dry-run'`,
`apps/api-worker/src/cron/retail-offers-retention.ts`); the live flip is a
reviewed one-line change at the registration site and is **not** applied here —
it awaits owner review of this report. Every query below was read-only
`wrangler d1 execute … --remote --json`: `rows_written: 0`,
`changed_db: false`, `served_by_primary: true` throughout. Nothing was deleted.

The selection mirrors the committed `SELECT_SUPERSEDED_IDS_SQL` predicate
exactly (superseded = anti-join form of rn ≥ 2 under
(`observed_at` DESC, `id` DESC) per (`merchant`, `product_id`)), with the
handler's cutoff construction: deploy instant `2026-10-25T17:06:15Z` minus 30
days → `.toISOString()` = **`2026-09-25T17:06:15.000Z`**, string-compared
against `observed_at` stored as `strftime('%Y-%m-%dT%H:%M:%fZ','now')`.

| Metric (production, cutoff `2026-09-25T17:06:15.000Z`) | Rows |
|---|---|
| Total `retail_offers` rows | 282 253 |
| **Deletion candidates (superseded AND past 30-day window)** | **50 275** |
| Superseded within window (kept by design) | 207 434 |
| Deterministic-latest per (merchant, product_id) — must survive | 24 544 |
| …of which themselves past the window, surviving via anti-join rule | 14 |

Partition check: 50 275 + 207 434 + 24 544 = 282 253 ✓.
Superseded split check: 50 275 + 207 434 = 257 709 superseded total ✓.
**Deleted: 0.** Live mode would delete at most 20 000 rows/night
(40 × 500), draining the 50 275-row backlog in ~3 nights.

## EXPLAIN QUERY PLAN pins (production data)

| Query | Plan |
|---|---|
| `SELECT id FROM product_master WHERE ean='x'` | `SEARCH product_master USING COVERING INDEX product_master_ean_idx (ean=?)` |
| `SELECT id FROM product_master WHERE name=? AND brand=? AND container_type=? AND unit_volume=?` | `SEARCH product_master USING COVERING INDEX product_master_name_brand_container_volume_idx (name=? AND brand=? AND container_type=? AND unit_volume=?)` |
| `SELECT COUNT(DISTINCT product_id) FROM retail_offers INDEXED BY retail_offers_observed_at_product_idx WHERE observed_at>='2026-10-19'` | `SEARCH retail_offers USING COVERING INDEX retail_offers_observed_at_product_idx (observed_at>?)` (+ `USE TEMP B-TREE FOR count(DISTINCT)`, expected) |

All three pin `SEARCH` on the migration-0041 indexes in production; no
full-table `SCAN` remains on the changed paths.

## Cron trigger sanity

The run log's api-worker deploy step shows `Deployed rajahinta-api-production
triggers` with **9 patterns applied unchanged**:
`0 * * * *`, `*/30 * * * *`, `0 */6 * * *`, `0 2 * * *`, `30 3 * * *`,
`0 4 * * *`, `0 5 1 * *`, `0 6 * * 1`, `0 0 1 1 *`.

- The `0 */6 * * *` handlers (`merchant-reliability-aggregates`,
  `data-quality-gauges` — per `src/cron/router.ts`) first fire at the next
  even-UTC-hour :00 after the deploy, i.e. 2026-10-25T18:00:00Z.
- The `30 3 * * *` retail-offers retention tick first fires
  2026-10-26T03:30:00Z — **in dry-run mode**: it logs the DRY-RUN candidate
  count (expected ≈ 50 275) to Workers Logs at `warn` and deletes nothing.

## 48 h read observation protocol (task 5.3 close-out)

Re-run the daily GraphQL query on/after **2026-10-27** (full first post-deploy
day = 2026-10-26):

```
POST https://api.cloudflare.com/client/v4/graphql   (Bearer: operator token)
{ viewer { accounts(filter: { accountTag: "29f50b2c…" }) {
    d1QueriesAdaptiveGroups(limit: 100,
      filter: { databaseId: "f8f67277-5046-46fc-9144-4342ab7af003",
                datetimeHour_geq: "2026-10-26T00:00:00Z",
                datetimeHour_leq: "2026-10-27T00:00:00Z" },
      orderBy: [date_ASC]) {
      dimensions { date } sum { rowsRead } } } } }
```

(Note: `d1QueriesAdaptiveGroups` hangs off the `accounts` node, not `viewer`
directly.) Expect total prod reads **< 15M/day** vs the ~207M/day (measured
2026-10-24) pre-deploy baseline; the retention sweep itself stays read-only in
dry-run, so no read budget is spent on deletions.

## Billing budget alert (report only — operator action)

The API token cannot read billing settings, so this could not be verified
programmatically: the operator should confirm the **~$15 budget-alert
threshold** under Cloudflare dashboard → **Billing → Budgets** (the earlier
invoice analysis flagged it) and raise it if the D1 read-cost drop changes the
projected spend profile.

## Blockers / follow-ups

- None blocking this change. The frontend production deploy remains blocked
  repo-wide by the pre-existing OpenNext/Next-15.5.24 gate (see 5.2) —
  repo-level fix out of scope here.
- Owner decisions pending this report: (1) retention live-mode flip (one line,
  at the registration site), (2) billing budget threshold confirmation,
  (3) 48 h read observation re-check on/after 2026-10-27.

## LIVE FLIP (owner decision, 2026-10-25)

After the owner's independent verification of the dry-run report (window-CTE
re-measure matching the anti-join count exactly at 50,275; survivors 24,544;
partition sums exact; `rows_older_than_any_summary = 0` — every candidate
covered by BOTH the R2 observation log AND `price_history_summaries`), the
one-line flip at the registration site was applied:

- `router.ts`: `run: (env, log) => handleRetailOffersRetention(env, log, { mode: 'live' })`
  with the decision recorded in the registration comment
- router dispatch test re-pinned (live mode deletes the seeded candidate,
  keeps the deterministic-latest): 26/26 pass, typecheck clean
- Deploy run 40218208151 (same dispatch gate): **Deploy API Worker ✓** —
  version `c6b6d94a-395f-4904-8545-3e815f49c8c5` (superseding `9208b7a8`),
  triggers applied; job conclusion `failure` is solely the pre-existing
  OpenNext/Next-15.5.24 frontend gate (unchanged, repo-wide)
- Post-deploy smoke: `/api/v1/health` 200; `/health/ready` d1 up (139 ms) +
  durableObjects up (335 ms); `/api/v1/products?limit=1` 403 ungated / 200
  with `x-age-confirmed`

First live tick: 2026-10-26T03:30:00Z — expect ~20,000 deletions (40 × 500),
`info` log `Retail-offers retention: deleted …`; ~50,275-row backlog drains
over ~3 nights, then the table stays bounded (30-day window + current rows).
Rollback if ever needed: revert the one line, redeploy (dry-run default).

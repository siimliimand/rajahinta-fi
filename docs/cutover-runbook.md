# Cutover runbook — K8s/Nest → Cloudflare Workers

Task 6.6, change `migrate-to-cloudflare`. Operational sequence for the
one-time production cutover described in design **D10** (with **D4 as
amended by G1**: observations in R2, age-capped calculation records).
Every artifact this runbook references is in the repository:

| Artifact | Path |
|---|---|
| ETL (Postgres → D1 + R2) | `scripts/etl-pg-to-d1.ts` |
| Parity harness | `scripts/dual-run-parity.ts` |
| Production environment description | `infra/environments/prod.yaml` |
| Production deploy pipeline | `.github/workflows/deploy-production.yml` (manual, `confirm_deploy == 'yes'`) |

Roles: **ops lead** executes the runbook; the **platform engineer** owns
application-level behavior; the **devops engineer** owns DNS, deploy
pipeline, and this document.

---

## 0. Preconditions (all must hold before step 1)

- [ ] **CI green on `main` and on the release commit**: unit, integration,
      golden dataset, compliance, D1 suites (`pnpm test`, `pnpm test:golden`,
      `pnpm test:compliance`, `pnpm test:d1`).
- [ ] **Staging soaked**: staging Workers deployed by pipeline
      (`deploy-staging.yml`: migrate → seed → rollout) and healthy for the
      agreed soak period; e2e-browser suite green against staging.
- [ ] **Production deployed but NOT receiving traffic**: run the gated
      `deploy-production.yml` (approve `confirm_deploy == 'yes'`). The
      pipeline migrates D1 and deploys the Workers — it deliberately has
      **no seed step** (production data arrives via the ETL, task 6.5).
- [ ] **Health gate green**: `GET $PRODUCTION_API_URL/api/v1/health/ready`
      returns 200 (D1 roundtrip + DO ping, design D8).
- [ ] **Backups taken and verified restorable**:
  - **Postgres**: `pg_dump -Fc` of the production database, copied off-cluster,
    restore-tested into a scratch instance (`pg_restore` lists and row counts
    match the source's `\dt+` counts).
  - **D1 (target, pre-ETL baseline)**: `wrangler d1 export` of
    `rajahinta-api-production` (empty-schema snapshot) — this is the
    forward-only-migration anchor for rollback (see §5).
- [ ] **DNS TTL lowered** at least 48 h before cutover: the
      `rajahinta.fi` / `api.rajahinta.fi` A/AAAA/CNAME records to **60 s**
      (this is the cutover lever — do it early, verify with repeated
      `dig +short`).
- [ ] **Observation R2 bucket ready**: `rajahinta-observations-production`
      exists, EU jurisdiction, `OBSERVATION_LOG` binding live (task 6.5).
- [ ] **Freeze**: ingestion cron/queues on the K8s stack keep running
      during dual-run (both stacks must see the same data); **schema
      changes on pg are frozen** from here until decommission (task 6.7).

---

## 1. ETL: Postgres → D1 + R2 (one-time)

The ETL is **read-only on Postgres** and idempotent on D1
(`INSERT OR IGNORE`, explicit ids preserved). Run it from a machine with
network access to both Postgres and Cloudflare.

### 1.1 Dry run (validates without emitting or importing)

```bash
pnpm --filter @rajahinta/data-platform exec tsx \
  ../../scripts/etl-pg-to-d1.ts --pg-url "$PROD_PG_URL" --dry-run
```

Expected: `ok` on every table row-count line, no `EtlValidationError`.
**Any `EtlValidationError` is a stop**: unknown CHECK/enum values (e.g.
`product_master.container_type` outside the migration-0002 set) are listed
row by row. Fix the data upstream (or extend the D1 value set with a
forward-only migration) and re-run. **The ETL never invents a mapping.**

### 1.2 Emit artifacts

```bash
pnpm --filter @rajahinta/data-platform exec tsx \
  ../../scripts/etl-pg-to-d1.ts --pg-url "$PROD_PG_URL" --out /tmp/etl-prod
```

Produces, in `/tmp/etl-prod`:

- `NN-<table>.d1.sql` — 18 files, FK-safe order, batched multi-row
  `INSERT OR IGNORE` (JSONL for `wrangler d1 import` alternative:
  `--format jsonl`).
- `observations/YYYY-MM-DD.jsonl` — the R2 observation log in the exact
  task-2.3 layout (reuse of `observation-log.ts` serializer). These go to
  **R2, never D1**.
- `00-manifest.json` — per-table in/out counts + sha256 of every file.
- `99-verify.sql` — post-import per-table `COUNT(*)` query.

### 1.3 Import D1 (production, in manifest order)

```bash
cd apps/api-worker
for f in /tmp/etl-prod/[0-9][0-9]-*.d1.sql; do
  wrangler d1 execute DB --remote --env production --file "$f" -y || exit 1
done
wrangler d1 execute DB --remote --env production --file /tmp/etl-prod/99-verify.sql --json -y
```

Compare the verify output field-by-field with `00-manifest.json` —
**every count must match exactly** (this is the same loud-verify contract
the seed pipeline uses). Mismatch → stop, `wrangler d1 execute` the
rollback export from §0 if D1 must be restored, investigate, re-run ETL.

### 1.4 Upload the observation log to R2

```bash
for f in /tmp/etl-prod/observations/*.jsonl; do
  wrangler r2 object put rajahinta-observations-production/"$(basename "$f")" \
    --file "$f" --content-type application/jsonl -y || exit 1
done
```

Verify: object count and byte sizes match the manifest's `observations`
partition entries; spot-read one partition with
`wrangler r2 object get` and re-parse it with `parseObservationLog`.

### 1.5 ETL re-runs (incremental)

`--table <name>` (repeatable) re-emits a subset — useful if a single table
failed verification. Tables are re-imported idempotently. The ETL is a
**one-time cutover tool**: if the dual-run window is long, re-run the full
ETL immediately before the DNS switch (§3) so rows written to pg during
the window are carried over — then apply any deltas again right before
flipping DNS and re-verify counts.

---

## 2. Dual-run window (parity gate)

Both stacks run concurrently: K8s/Nest serves production DNS traffic; the
Workers stack is warm, ETL-loaded, and health-gated.

### 2.1 Traffic sampling

The Worker receives sampled real traffic without touching user-facing
DNS — mirror a slice of live requests at the edge/load-balancer layer to
`$PRODUCTION_API_URL` (workers.dev route or an internal hostname). Keep
the sample read-biased (calculator GET-path effects only; POST paths run
through the same calculator endpoint and are safe to replay — idempotency
keys are version-aware on both stacks).

### 2.2 Parity harness on a schedule

Run the harness from CI (scheduled workflow) or an ops cron, at minimum
**every 6 hours** during the window:

```bash
pnpm --filter @rajahinta/data-platform exec tsx \
  ../../scripts/dual-run-parity.ts \
  --baseline-url "https://api.rajahinta.fi" \
  --worker-url   "$PRODUCTION_API_URL" \
  --sample-size 25 \
  --report-json "/tmp/parity/$(date -u +%Y%m%dT%H%M%SZ).json"
```

Behavior: the **golden 5 cases always run** (beer/wine/spirits totals,
gate rejection, mixed currency), plus 25 products sampled from the
baseline's product list. A case passes only when both stacks return the
same status, the same field set, equal cents, and valid
reliability/confidence enums; volatile fields (wall-clock timestamp,
record id) are stripped before diffing.

The harness paces its own requests per origin (default 8/min — the
CALCULATOR rate-limit profile admits 10/min per client on both stacks)
and absorbs one 429 with Retry-After backoff, so a sampled pass cannot
rate-limit itself into a false mismatch; a sampled run of 25 therefore
takes a few minutes, which is fine at the cadence above. A persistent
one-sided 429 still reports as a status-parity failure and stops the
clock.

**Acceptance bar (design D10: "error-free")**: **zero mismatches across
N consecutive days** (agree N with the platform engineer before the
window opens; recommended N = 3, i.e. ≥ 12 consecutive green runs).
Any red run: freeze the cutover, triage the reported diffs (paths +
values are in the report), fix, and restart the N-day clock.

### 2.3 Data drift during the window

Both stacks read their own datastore. The K8s ingestion pipeline keeps pg
fresh; the Worker's own ingestion (Queues/Workflow) must be **paused or
deduped** so the two stores converge only through the pre-cutover ETL
re-run (§1.5). Do not let both pipelines write during the window —
duplicate merchant messages are exactly the class of divergence parity
cannot see.

---

## 3. DNS cutover (the one-time lever)

Prerequisite: §2 acceptance bar met, fresh ETL run + import + verify
completed (§1.5), backups refreshed (pg dump + `wrangler d1 export`).

Order of operations (each step verified before the next):

1. **Attach the custom domain / Workers route first, before any DNS
   change**: `wrangler deploy --env production` already carries the
   routes config; confirm the `rajahinta.fi` + `api.rajahinta.fi`
   custom hostnames show **Pending → Active** in the Cloudflare
   dashboard (SSL certificates issued). Nothing serves from them yet.
2. **Canary the Worker origin directly**: hit
   `$PRODUCTION_API_URL/api/v1/health/ready` and one golden calculator
   case through the workers.dev/custom-hostname origin; run the parity
   harness `--golden-only` one final time.
3. **Flip DNS**: point `api.rajahinta.fi` (API) and then `rajahinta.fi`
   (frontend) at the Workers custom domains — with TTL still at 60 s
   from §0. API first: a stale frontend hitting the new backend is the
   safe failure direction (contract-compatible), the reverse is not.
4. **Watch**: readiness endpoint, Workers Analytics Engine request
   counters, Grafana traces (OTLP destination unchanged, design D8), and
   the freshness alert cron. Keep the harness running
   `--golden-only` against the old baseline (now idle) for reference.
5. **Record** the flip timestamp — it starts the rollback-window clock (§5).

---

## 4. Post-cutover observation

- The Worker cron set (prod.yaml `crons`) now owns ingestion, transport
  refresh, aggregation, retention sweeps. Confirm first runs in Workers
  logs.
- Retention per D4 amended: age cap (default 180 days) on calculation
  records via the scheduled `DELETE` sweep; anonymous rows keep the
  30-day window. Verify the sweep ran once within the first 24 h.
- Observations append to R2 (`observations/YYYY-MM-DD.jsonl`); confirm
  today's partition appears after the first ingestion cycle and the
  aggregation watermark advances (D1 `aggregation_watermarks`).

---

## 5. Rollback

**Mechanism.** Rolling back means: switch DNS back to the K8s stack.
The K8s cluster is kept **warm** (serving nothing but ready to serve)
for the agreed rollback window — decommissioning is task 6.7, after the
window closes. Rollback is a ~1-minute operation at TTL 60 s.

Two independent levers — do not confuse them:

1. **Workers-internal rollback** (`wrangler rollback --env production`,
   list with `wrangler deployments list`): restores the previous Workers
   Version **instantly, without DNS changes** (prod.yaml `rollback`).
   Use this for Worker-side regressions while staying on Cloudflare.
2. **DNS revert** (K8s again): repoint `api.rajahinta.fi` /
   `rajahinta.fi` at the load balancer. Use this when the Cloudflare
   platform as a whole must be abandoned.

**Data — the forward-only constraint.** D1 migrations are forward-only;
`wrangler rollback` and DNS revert **do not revert schema or data**.
Consequences, by window:

| Writes after cutover | On rollback they are… |
|---|---|
| D1 rows (calculations, sessions, offers) | **Marooned in D1.** The K8s stack cannot see them. Acceptable to lose (calculator re-runs are cheap and side-effect-free) — but saved baskets/scenarios and account sessions created post-cutover will 404 on the K8s stack. Triage before reverting: export the post-cutover delta (`wrangler d1 export`) for later reconciliation. |
| R2 observation partitions | Not seen by the K8s aggregation job. Keep the objects (R2 is the long-term record per D4); re-import later via the same JSONL layout. |
| Ingestion-side changes | The K8s BullMQ pipeline resumes against pg, which was frozen at the last pg-accepted state. Re-run the pre-cutover pg dump restore check if the freeze was violated. |

**Rollback decision checklist** (any box triggers it):

- [ ] Parity harness red on the golden 5 after a hotfix attempt.
- [ ] `health/ready` failing past the alert threshold with no Worker fix.
- [ ] Data-integrity report (D1 write errors, R2 append failures).
- [ ] Compliance regression (calculation explainability, rate-versioning
      enforcement — prod.yaml `compliance` block must hold identically).

After a rollback: open an incident, root-cause with the parity reports,
and schedule a new cutover from §0 (the whole runbook re-runs; nothing
here is one-shot except the ETL's data, which re-runs cleanly).

---

## 6. Decommission gate (feeds task 6.7)

Tick **all** before decommissioning the K8s stack:

- [ ] Rollback window elapsed with zero DNS reverts.
- [ ] Parity harness green for the final M consecutive runs (M = the
      agreed post-cutover confirmation count) with the K8s stack
      switched off — proving no hidden baseline dependency.
- [ ] No pg writes since cutover: `SELECT max(created_at)` spot-checks on
      the mutable pg tables are older than the flip timestamp.
- [ ] Final pg dump archived (compliance retention) **before** the
      cluster is destroyed; D1 export archived alongside.
- [ ] R2 observation log complete: no gap between the last pg-derived
      partition and the first Worker-written partition (manifest from
      §1.4 vs live `wrangler r2 object list`).
- [ ] Monitoring ownership moved: Grafana dashboards re-pointed
      (design D8), freshness alert email confirmed received by ops
      (task 6.3 path), PrometheusRule paging for the K8s stack removed.
- [ ] DNS TTL raised back to the production default (3600 s) — the
      low-TTL period is over.
- [ ] `infra/` K8s manifests marked for deletion in task 6.7's scope;
      prod.yaml `rollback.dns_note` updated to historical.

Once gated, task 6.7 removes the K8s stack, the Nest entry points, and
the Redis/BullMQ substrate — **not before**.

# Notes — daily-scrape-cadence-current-offers

## Registry update (task 2.2)

Move the existing `alks` registry row from hourly to daily cadence
(`polling_interval_ms` 3,600,000 → 86,400,000) through the ops
`registerMerchant` path — an operator console action, **no deploy
needed** (registry rows are read at each hourly tick).

**Status: NOT yet executed.** The command below is prepared for the
operator; staging first, then production. This environment cannot
reach staging/production from the implementation sandbox.

### Command (staging)

`POST /ops/console/merchants` — the register/upsert handler in
`apps/api-worker/src/routes/ops.routes.ts` (`registerMerchant`),
behind the `/ops/console/*` ops-access guard
(`Authorization: Bearer $OPS_BEARER_TOKEN`, a per-environment secret;
requests without it are denied 403):

```bash
curl -X POST "$STAGING_API_URL/ops/console/merchants" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "merchantId": "alks",
        "name": "Alks",
        "country": "DE",
        "feedUrl": "https://alks.fi",
        "feedFormat": "json",
        "pollingIntervalMs": 86400000,
        "operator": "<operator name — recorded as the audit author>",
        "note": "change 2026-09-13-daily-scrape-cadence-current-offers: alks cadence hourly -> daily"
      }'
```

### Command (production)

Same body against the production origin
(`https://api.rajahinta.fi`), with the production
`OPS_BEARER_TOKEN`:

```bash
curl -X POST "https://api.rajahinta.fi/ops/console/merchants" \
  -H "Authorization: Bearer $OPS_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "merchantId": "alks",
        "name": "Alks",
        "country": "DE",
        "feedUrl": "https://alks.fi",
        "feedFormat": "json",
        "pollingIntervalMs": 86400000,
        "operator": "<operator name — recorded as the audit author>",
        "note": "change 2026-09-13-daily-scrape-cadence-current-offers: alks cadence hourly -> daily"
      }'
```

### Operational facts

- **`pollingIntervalMs` must be in the body.** The route's default is
  3,600,000; the upsert overwrites the whole registry row, so an
  update that omits the field silently resets alks to hourly.
- Expected response: `registered: "updated"`, `autoGranted: false`
  (alks already has governance records — re-registration never touches
  them), `permissionStatus: "GRANTED"`. The registry change is audited
  (an `audit_events` row with `entityType: merchant_registry`).
- Effective at the next hourly tick: with the task 1.1 interval-bucket
  gate, the 86,400,000 ms row fires on the 00:00 UTC pass (minimum
  schedulable interval is 3,600,000 ms — see the ingestion runbook §0).

### Why the ops step is required (seed scope, task 2.1)

The seed change (task 2.1: `MERCHANT_REGISTRY_SEED`, shared by the pg
seed and the D1 seed — `scripts/seed-d1.ts` imports the constant via
`seed/d1/generate.ts`, no duplicated rows) only affects **fresh
databases**: bootstrap seeding is idempotent-upsert and re-running it
would overwrite operator edits, so existing environments are never
reseeded. Staging keeps its current hourly row until the command above
runs, and production is never seeded at all (`deploy-production.yml`
has no seed step) — the ops call is the only path there.

## Verification (task 5.1)

Local sweep 2026-09-13, all exit 0: `pnpm lint`, `pnpm typecheck`, `pnpm lint:content`, `pnpm -r test` (frontend 782, api-worker 913, data-platform 647, data-acquisition 218, application-api 725+3 skipped, backend 19), `test:golden`, `test:data-quality`, `test:compliance`, `test:d1`, `test:integration`, `test:e2e`.

One pre-existing repo hygiene fix made during the sweep: `tests/e2e-browser/playwright-report-workers/` (generated Playwright trace residue, git-ignored as `playwright-report/` but not the `-workers` variant) was linted and failed eslint; the stale directory was deleted and `**/playwright-report*/` added to the eslint flat-config ignores.

Staging evidence is BLOCKED until deploy: it needs (1) the task-2.2 registry edit applied to staging (`pollingIntervalMs` 86400000 for alks — command in the section above), then (2) two daily producer passes observed in Worker Logs (one `price-ingestion-alks-<day>` enqueue per 24 h, `skippedNotDue` incrementing on the other 23 hourly ticks), and (3) a product page check showing a single Retail prices row for alks. Post-deploy operator step, not a code task.

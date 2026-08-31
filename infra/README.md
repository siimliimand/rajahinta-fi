# Infra

Environment configs and pipeline docs for Rajahinta.fi deployments.

The platform runs on **Cloudflare Workers** (change `migrate-to-cloudflare`;
designs D1–D10): an OpenNext frontend Worker, a Hono API Worker, an email
Worker, and the Cron/Queues/Workflows substrate. The former K8s/Docker
production path (`infra/k8s/`, production Dockerfile, `infra/jobs/`,
ServiceMonitor/PrometheusRule) was deleted at decommission (task 6.7),
after the cutover rollback window closed (`docs/cutover-runbook.md` §6).

## Layout

```
infra/
  environments/
    dev.yaml       # local development (wrangler dev, local D1/R2/DO simulators)
    staging.yaml   # pre-production validation (workers.dev staging URLs)
    prod.yaml      # production hardened (custom domains, gated deploys)
  staging-data/    # test fixture SQL (staging-reviews.sql feeds scripts/test-data-quality.sh)
  README.md
```

## Pipeline

```
feature/* branch  -- push/PR -->  CI        build + unit + golden + d1 + wrangler dry-runs
push to master    -- event -->    STAGING   migrate → seed → deploy → health gate (deploy-staging.yml)
manual dispatch   -- gate -->     PROD      migrate → deploy, NEVER seeded (deploy-production.yml,
                                            approval via confirm_deploy == 'yes')
```

## Environments

### DEV (development)

- **Trigger:** every push / PR — CI validates (lint, typecheck, unit, golden, compliance, D1 suites, per-worker `wrangler deploy --dry-run`)
- **Target:** local simulators (`wrangler dev` — local D1, miniflare DOs/R2)
- **Secrets:** none (local placeholder config in the wrangler.jsonc files)
- **Config:** `infra/environments/dev.yaml`

### STAGING

- **Trigger:** push to `master` (`deploy-staging.yml`: D1 migrations → seed → deploy → health gate)
- **Target:** Workers on the staging workers.dev URLs (per `staging.yaml`); the e2e-browser suite runs green against staging (runbook §0)
- **Data:** independent D1 database, seeded with the official tax versions by `scripts/seed-d1.ts` (loud verify)
- **Secrets:** GitHub Environment "staging" — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Variables:** `STAGING_API_URL` (api-worker staging base URL, health gate + artillery target)
- **Config:** `infra/environments/staging.yaml`
- **Data plane:** D1 `rajahinta-api-staging`, R2 buckets (observations, rate snapshots, ISR cache) — all EU jurisdiction

### PRODUCTION

- **Trigger:** manual `workflow_dispatch` with `confirm_deploy == 'yes'` (`deploy-production.yml`)
- **Checks:** D1 migrations → deploy → health gate (`GET /api/v1/health/ready`). **No seed step** — production data arrives via the one-time ETL (task 6.6, `docs/cutover-runbook.md`)
- **Gate:** manual approval (workflow input), EU-resident data plane per design D9
- **Secrets:** GitHub Environment "production" — `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- **Variables:** `PRODUCTION_API_URL` (production base URL, health gate)
- **Worker secret:** `EMAIL_SEND_SECRET` (api-worker + email-worker, must match; set per environment via `wrangler secret put`)
- **Config:** `infra/environments/prod.yaml`
- **Rollback:** `wrangler rollback` (previous Workers Version, no DNS) — see prod.yaml `rollback`; the K8s DNS-revert lever was retired at decommission

## Compliance rules

Enforced in staging and production (unchanged across the migration):

1. **Rate versioning** -- every rate change creates a new dataset version. Historical rates stay queryable.
2. **Calculation explainability** -- every calculated figure is traceable to its input values, rate version, and timestamp. No orphan numbers.
3. **Data freshness** -- every externally sourced fact carries a reliability status and collection timestamp; the cron freshness checker alerts ops via the email Worker (design D8).
4. **Feature flag gating** -- new merchant sources, new tax rulesets, and new ranking logic are behind flags for instant rollback.
5. **Structural disclaimer** -- the "estimated total cost, not final legal tax liability" disclaimer is baked into every result object, not just the UI.

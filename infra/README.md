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
  grafana/         # Grafana Cloud artifacts: data-quality dashboard + threshold alerts
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

## Data-quality panel

`infra/grafana/` holds the Grafana Cloud artifacts for the data-quality
surface (task 4.1, change `data-quality-and-publication-trust`). The
metric data itself lives in the Workers Analytics Engine dataset the
api-worker writes (`rajahinta-api-metrics-{dev,staging,production}` —
metric names, write shapes, and AE SQL queries are documented in
`apps/api-worker/src/observability/METRICS.md`); these files are the
importable view + paging layer.

**What it covers** — the five data-quality panels and their threshold
alerts:

| Panel | Metric (AE `index1`) | Alert | Fires when |
|---|---|---|---|
| Zero-price rejections per run | `rajahinta_data_quality_zero_price_rejections_total` | `RajahintaZeroPriceRejectionsNew` (warning) | any rejection in a 1 h window (`> 0`, immediate) |
| Implausible-volume share | `rajahinta_data_quality_implausible_volume_share_ratio` | — (dashboard view; the count is gate-held, not published) | — |
| Alko reference coverage % | `rajahinta_data_quality_alko_reference_coverage_ratio` | `RajahintaAlkoReferenceCoverageNearZero` (critical) | coverage `< 0.05` for `2h` (the `== 0` scenario included) while the savings surface is enabled |
| Transport offer rows per carrier | `rajahinta_transport_offer_rows` (`carrier` label) | `RajahintaTransportOfferRowsZero` (warning) | a carrier sits at `< 1` row for `30m`; expected carriers are written as honest 0s |
| Per-feed last-success age | `rajahinta_feed_last_success_age_seconds` (`merchant` label) | `RajahintaFeedLastSuccessStale` (warning) | age `> 2d` (2× the registry's daily cadence) for `1h`; a never-successful feed's `+Inf` sentinel breaches it by construction |

Thresholds and `for` clauses track the merchant-registry feed cadences
(daily price feeds; 6-hourly transport refresh; 30-min gauge tick) —
the provenance notes are in the header of
`data-quality-alerts.yaml`. Freshness invariants (stale-price share,
transport newest-offer age) intentionally do **not** page from Grafana:
they are evaluated from D1 by the in-Worker freshness-alert cron
(`apps/api-worker/src/cron/freshness-alert.ts`) and delivered via the
email Worker.

**How to import** (one-time per Grafana Cloud stack):

1. Create the AE SQL data source once: a JSON/Infinity-type data source
   POSTing to `https://api.cloudflare.com/client/v4/accounts/<account
   id>/analytics_engine/sql?dataset=<dataset>`, credentials in the data
   source config (never in git). The query shape is in METRICS.md,
   "Querying".
2. Dashboard: Grafana → Dashboards → Import →
   `data-quality-dashboard.json`. Import asks for the data source
   (`DS_AE_METRICS` input) and the Cloudflare account id
   (`CF_ACCOUNT_ID` variable). For staging, switch the `AE_DATASET`
   variable to `rajahinta-api-metrics-staging`.
3. Alerts: `data-quality-alerts.yaml` is Grafana provisioning format
   (`apiVersion: 1`). Apply it by replacing the `RAJAHINTA_AE_DATASOURCE_UID`
   placeholder with your data source's uid and the `CF_ACCOUNT_ID`
   literal in the panel URLs, then provisioning it (self-managed Grafana:
   drop into the provisioning directory; Grafana Cloud: import the rules
   via UI or the `/api/v1/provisioning/alert-rules` API, or `grafana-cli
   --cloud …` provisioning). Note the three cadence-gauge rules ship with
   `noDataState: Alerting` on purpose — a silent gauge writer is itself
   the blind spot the deployment-observability spec forbids, so expect a
   NoData→Alerting page until the writer seam is live.

**Where alerts route** — the rules carry only `severity` + `team`
labels; routing (email/Slack/on-call) is your Grafana Cloud notification
policy's job (Alerting → Notification policies). No endpoints or
credentials are committed: the data source and contact points hold them.

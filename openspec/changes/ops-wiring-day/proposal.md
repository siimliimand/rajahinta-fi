# Ops wiring day

## Why

Four items in the launch-ops backlog looked like open wiring work; an explore session (2026-10-11) verified each against source and live state and found most of the scaffolding already exists. What actually remains:

1. **Zero `rajahinta-*` R2 buckets exist** (verified live via the CF API). The app fails soft to a disabled placeholder — rate snapshots are simply off. Five named buckets in `wrangler.jsonc` were never created (`eu` jurisdiction).
2. **Staging freshness alerting is OFF, not just misaddressed.** The alert gate (`apps/api-worker/src/cron/freshness-alert.ts:467-470`) requires `EMAIL_SEND_SECRET` AND (binding OR `EMAIL_WORKER_URL`) AND `FRESHNESS_ALERT_EMAIL_TO`. Staging has the `EMAIL_WORKER` service binding, but `EMAIL_SEND_SECRET` is absent (referenced nowhere in deploy-staging.yml) and the recipient is the dead `ops@example.com` — so the cron skips evaluation every tick. Alerting silently cannot fire in staging.
3. **The load baseline has never been captured** although `STAGING_API_URL` exists as a repo variable (since 2026-08-31) and the live Artillery phase is unblocked. ARCHITECTURE §15 already notes the follow-up: promote to blocking once a staging baseline exists.
4. Staging deployed green today (health gate: D1 roundtrip + DO ping), but the wiring items above were not part of that verification.

Also found: the frontend **staging** env binds its R2 cache to `rajahinta-frontend-cache-**dev**` (`apps/frontend/wrangler.jsonc` staging block) — a copy-paste this change corrects while creating buckets.

## What Changes

- **R2 buckets (dev + staging):** create `rajahinta-observations-{dev,staging}`, `rajahinta-rate-snapshots-{dev,staging}`, `rajahinta-frontend-cache-staging` (jurisdiction `eu`) via wrangler + the deployment token; fix the frontend staging cache binding to the `-staging` bucket.
- **Honest staging email vars:** `EMAIL_WORKER_URL` → `https://rajahinta-email-staging.siim-liimand.workers.dev`, `FRESHNESS_ALERT_EMAIL_TO` → `siim.liimand@gmail.com` (mirrors the committed prod pattern and the email worker's pinned destination; workers.dev URLs are not secrets).
- **Staging `EMAIL_SEND_SECRET`:** operator-supplied shared value (must match the email worker's secret) set once via `wrangler secret put --env staging` — secrets persist across deploys, no workflow change.
- **Redeploy + verify:** dispatch deploy-staging; health gate green; buckets bound; email worker URL responds; freshness cron no longer reports "not configured".
- **Load baseline:** dispatch load-tests.yml against `STAGING_API_URL`; record p95/error rate in the change notes as the first baseline. The promote-to-blocking decision (Decision D) is deliberately made AFTER the numbers exist — out of scope here.
- **Docs truthfulness:** update the "placeholder today" comments in `infra/environments/staging.yaml` once the values are live.

## Non-goals

- **Faro RUM (#3):** code is complete (`faro-init.ts` env-gated no-op, unit-tested); needs 2 workflow env lines + 2 GitHub vars once a Grafana Faro app exists. Ready 2-line follow-up, deferred by operator choice.
- **Production buckets:** created when prod feature work needs them.
- **Load-gate promotion (Decision D):** decided against the recorded baseline in a follow-up.

## Impact

- Ops/config only: 5 bucket creations, one committed wrangler.jsonc vars edit, one frontend binding fix, one secret put, two workflow dispatches. No application code, no schemas, **no spec deltas** (the ci-cd-pipeline spec contract already describes exactly this deploy path) → `skip_specs: true`.
- One operator-supplied value was originally planned in-session (task 1.3, staging `EMAIL_SEND_SECRET`); the operator declined on 2026-10-11 — staging freshness alerting stays OFF until that secret is set, recorded in tasks.md as a skipped task with its revisit trigger.

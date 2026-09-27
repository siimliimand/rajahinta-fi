# Rollout notes for client-experience-improvement (task 6.2)

Date: 2026-09-27. Branch: `feature/client-experience-improvement` (13 commits, pushed at 10:24 UTC). All local verification from 6.1 was already green before rollout.

## Deploys

| Run | Workflow | Trigger | Result |
|---|---|---|---|
| [36312477046](https://github.com/siimliimand/rajahinta-fi/actions/runs/36312477046) | Deploy Staging | `workflow_dispatch` on the branch ref | success (2m49s) |
| [36313628098](https://github.com/siimliimand/rajahinta-fi/actions/runs/36313628098) | Deploy Production | `gh workflow run deploy-production.yml --ref feature/client-experience-improvement -f confirm_deploy=yes` | success (2m33s) |
| [36312447190](https://github.com/siimliimand/rajahinta-fi/actions/runs/36312447190) | CI (push) | push | failure, see "CI red" below |
| [36312447221](https://github.com/siimliimand/rajahinta-fi/actions/runs/36312447221) | E2E browser (push) | push | success |

One deviation from the task's expected pipeline shape: `deploy-staging.yml` triggers on push to `master` only (plus a no-input `workflow_dispatch`), so pushing the feature branch did not start a staging deploy. Rather than merging to master, the staging workflow's own manual trigger was used with `--ref feature/client-experience-improvement`, which deploys the branch code to staging through the standard migrate, seed, deploy, health-gate path. The production workflow matches the expected shape exactly: `workflow_dispatch`, first step refuses to run unless `confirm_deploy=yes`, D1 migrate, then the three Workers, then an HTTP readiness gate.

Both deploy runs gamed green on `/api/v1/health/ready`. Pre-deploy probes on staging confirmed the old code was live (sort param 400'd with the Phase 1 message, benchmarks route 404); post-deploy both answered with the new behavior, so the run is proven to have shipped the branch.

## Staging verification (all six scenarios)

Staging frontend: `https://rajahinta-frontend-staging.siim-liimand.workers.dev`, API: `https://rajahinta-api-staging.siim-liimand.workers.dev`. Driver: `verify-staging.mjs` (plus `probe-f-staging.mjs` and `probe-c-staging.mjs` for two scenarios that needed a hydration-safe gate confirm), results in `staging-scenarios-result.json`, `staging-c-result.json`, screenshots `staging-*.png`.

| Scenario | Result | Evidence |
|---|---|---|
| a. Hero search pre-fill | PASS | submit on `/fi` landed on `/calculator?q=A+Le+Coq`, results rendered (`staging-a-hero-search.png`) |
| b. Age-gate decline recovery | PASS | decline to `/age-gate/declined`, recovery link "Painoin vahingossa — yritä uudelleen" re-presented the gate (`staging-b-*.png`) |
| c. Anonymous trip fill | PASS at surface level, data gap | see below (`staging-c-trip-fill.png`) |
| d. Catalog search + category + sort combined | PASS | URL state `?q=A+Le+Coq&category=beer&sort=LOWEST_PRICE`, 22 cards, LOWEST_PRICE accepted by the API (the old code 400'd it) (`staging-d-catalog-combined.png`) |
| e. Merchant CTA via outbound controller | PASS | CTA "Katso kaupassa →" href `/api/v1/outbound/66623`; GET with redirects disabled returned 302 to the merchant URL (`staging-e-product-cta.png`) |
| f. Friendly 429 | PASS | exhausted all 60 CALCULATOR slots (per-minute window, staging only); UI submission got 429 and rendered "Hetkinen — lasketaan vielä edellistä" (`staging-f-429-friendly.png`) |

Scenario c detail: the endpoint's anonymity change is live and proven. A raw POST with zero cookies reached the handler (no 401/403) and the UI path submitted end to end (fill mode, candidate, quantity, "Laske täyttö"), with `age_confirmed` the only cookie in the jar. Both calls returned `409 NO_ALLOWANCE_DATASET` ("no PUBLISHED allowance dataset covers travel date") because staging's journeys seed carries no `traveller_allowance_datasets` rows. That is the same gap 6.1 recorded: scenario c relied on a local-only fixture there. It is a staging data omission, pre-existing and unrelated to this change. Follow-up: add published allowance-dataset rows to the staging seed so this scenario can pass with real data.

## Production spot checks (read-only; no load, no bucket exhaustion, no order flows)

Frontend `https://rajahinta.fi`, API `https://api.rajahinta.fi`. Driver: `spotcheck-production.mjs`, results in `production-spotcheck-result.json`, screenshots `production-*.png`. All four checks passed at 10:57 UTC:

1. Homepage renders: title "Rajahinta.fi — Laske alkoholin kokonaishinta Suomeen", hero search input present.
2. Product detail renders with CTAs: product 1487 shows "Katso kaupassa →" pointing at `/api/v1/outbound/:offerId`. The link was not clicked; no synthetic click-through was sent to a merchant from production.
3. One calculator flow computes: a single prefill-driven submission returned 200 with the structural disclaimer visible.
4. `GET /api/v1/benchmarks/category-averages` returned 200 with 6 categories; the covered entries carry `asOf` (2026-09-27) and `reliabilityStatus` (ESTIMATED) (`production-benchmarks.json`).

## Success-metrics baseline (pre-change)

Production Analytics Engine dataset `rajahinta-api-metrics-production`, queried 2026-09-27 at 10:40-10:53 UTC via the AE SQL API, minutes after the production deploy and covering only pre-change traffic (the deploy introduced no traffic in the gap). Method: `POST /accounts/{account}/analytics_engine/sql?dataset=rajahinta-api-metrics-production` with `sum(_sample_interval)` per `index1` (route pattern) and `blob3` (status code); queries in `fetch-baseline.sh`, raw responses in `baseline-*.json`. Auth used the operator's local wrangler OAuth session; no tokens were copied or echoed.

| Metric | Window | Observed | Note |
|---|---|---|---|
| 429 share, calculator | 7 days | 0 of 8 requests = 0% | target < 0.1% |
| 429 share, calculator | 28 days (dataset start) | 0 of 10 requests = 0% | 9 completed (POST 2xx), 1 stray 404 |
| Outbound click-through | 28 days | 0 clicks | zero rows on the outbound route; denominator proxy 617 product-detail renders (`/api/v1/products/:id`); target > 15% |
| Calculator completion proxy | 7 days / 28 days | 8 / 9 completed (POST 2xx) | baseline pending for a real completion rate; there is no "start" event to divide by, so the table carries absolute counts |

Caveats: production traffic is very small this early, so these are counts, not robust rates, and 0% 429 shares reflect near-zero load rather than proven headroom. AE sampling is compensated by `_sample_interval` weighting. The dataset's earliest rows are about 28 days old, so 28 and 90 day windows are identical. Post-deploy, these same queries give the comparison window; re-run `fetch-baseline.sh` (it now also accepts 90 days) after a week or two of real traffic.

## CI red on the branch (follow-up, not a deploy blocker)

CI run 36312447190 failed one test: `tests/e2e/api.e2e.test.ts > E2E — rate limiting (CALCULATOR burst → 429) > engages the DO sliding window`, `AssertionError: expected null not to be null`. The test bursts 12 calculator requests expecting a 429 after the old 10-per-minute ceiling; task 2.5 raised CALCULATOR to 60/min, so the burst never reaches a limit. Reproduced locally with a single-test run. Two things worth knowing: the 6.1 evidence's `e2e.log` covers the legacy `apps/backend` e2e suite, not the worker e2e suite, which is how this slipped through local verification; and the deployed behavior itself is correct, as staging scenario f confirmed exactly 60 admitted requests and a friendly 429. Suggested fix (test-only): burst past 61 requests, or pin the profile limit in the e2e env, and delete the stale "ceiling is 10/min" comment in `tests/e2e/harness.ts`. Left to the lead since this task's scope excluded code changes.

## Files touched by this task

`openspec/changes/client-experience-improvement/rollout-notes.md` (this file). All other artifacts are uncommitted evidence under `.opencode/.tmp/6.2-evidence/`. No application, workflow, or wrangler config changes.

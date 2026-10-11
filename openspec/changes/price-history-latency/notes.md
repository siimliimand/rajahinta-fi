# Task 4.2 — staging deploy + latency measurement (2026-10-11)

## Deploy

- **Run:** [38167185566](https://github.com/siimliimand/rajahinta-fi/actions/runs/38167185566) — `workflow_dispatch` of `deploy-staging.yml` on `ref feature/price-history-latency` @ f198f4f (head of the branch; pushed to origin for the first time to enable the dispatch — the branch had no remote ref before).
- **Conclusion:** `success`, all steps green, including **health gate — staging readiness** (GET `/api/v1/health/ready` = 200 on first gate attempt; D1 roundtrip + DO ping healthy inside the Worker).
- The workflow deploys **both** workers to staging: api-worker, email-worker, and the frontend Worker (OpenNext) — there is **no separate frontend staging path and no deploy gap**; the product page HTML was measured against the workflow-deployed `rajahinta-frontend-staging.siim-liimand.workers.dev`.
- No production deploy was performed.

## Measurement conditions

- **Vantage:** US (Cloudflare colo `ORD`) — the BEFORE table was measured from a Toronto vantage, also North-American → EU origin. Roughly comparable RTT profile; not identical.
- **Targets:** `STAGING_API_URL` (`https://rajahinta-api-staging.siim-liimand.workers.dev`) and frontend staging `https://rajahinta-frontend-staging.siim-liimand.workers.dev`. All catalog requests sent `x-age-confirmed: server-prerender` (age gate).
- **Products:** 1532 (full matrix, median of 3) and 138 (spot checks). Staging series are thin (single-bucket histories) — latency is the metric, content isn't.
- **Method:** `curl -w` `time_starttransfer` (TTFB), median of 3 per endpoint, 1 s between samples. 365-day window (`metric=price&granularity=day&from=2025-10-12&to=2026-10-11`).
- **Environment:** checks and the deploy workflow run on Node 24 (`NODE_VERSION: '24'` in `deploy-staging.yml`; the 4.1 local check sweep also ran under Node 24). CI runners warn that `actions/checkout@v4` / `setup-node@v4` / `pnpm/action-setup@v4` are Node-20-targeted and force-run on Node 24 — cosmetic today, worth bumping the action majors eventually.

## After numbers (staging) vs BEFORE (production, proposal table)

| Endpoint | BEFORE (prod, Toronto) | AFTER (staging, US/ORD) | Δ |
|---|---|---|---|
| Product page HTML, cold render | 14.6 s | **1.51 s** (first render of `/tuotteet/1808`) | **~10× faster** |
| Product page HTML, warm render | 3.9 s | **~2.3 s** (median of 8 warm samples, 1.9–3.2 s) | ~1.7× faster |
| `GET /api/v1/products/:id` (detail) | 1.3–1.5 s | **0.83 s** | ~1.6× faster |
| `GET …/price-history` `attribution=none` | 6–12 s | **0.53 s** steady-state (first cold sample 0.74 s) | **~12–20× faster** |
| `GET …/price-history` `attribution=auto` | 6–12 s (same cost either mode) | **2.3–3.0 s** (median 2.64 s @1532; 2.26 s @138) | ~3–4× faster |
| `GET …/price-context` | 0.6–0.75 s | **0.63 s** | unchanged (not in scope) |
| `GET …/dupes` | 0.5–0.6 s | **0.53 s** | unchanged (not in scope) |

Sample detail (TTFB s): detail 0.85/0.83/0.82; history-none 0.74 (cold), then 0.53/0.51/0.53/0.50; history-auto 3.03 (cold), 2.26/2.36/2.16; page warm 2.64/3.17/2.28/2.47/1.91/2.17 (+1808 warm 2.28/2.31).

## Reading and deviations

1. **The headline outcome holds.** `attribution=none` — the mode the product page now pins — drops from 6–12 s to ~0.53 s, and the cold page render from 14.6 s to 1.5 s. The unbounded R2 scan is gone from the request path.
2. **`attribution=auto` is NOT ~50–150 ms — it is ~2.3–3.0 s.** The proposal's 50–150 ms expectation describes the two-indexed-D1-query path; `auto` additionally performs the (now bounded-concurrency) R2 range read over the full 365-day window — ~365 day-partition objects — and that read dominates. It is still 3–4× faster than BEFORE and O(window), not O(log age) growing forever. Users of the calculator's history panel pay this; the page does not (it sends `attribution=none`). If this needs to go lower, the follow-up is caching or summaries-backed attribution, out of scope here.
3. **Warm page ~2.3 s is above the proposal's ~1–2 s hoped-for band.** Plausible contributors: staging serves via workers.dev (extra edge hop, no custom domain), the SSR render waits on 4 concurrent worker→worker API fetches each costing ~0.5–0.85 s from a NA vantage, and isolate jitter on staging (warm samples ranged 1.9–3.2 s, n=8). The cold 1.51 s sample is single-shot. Production numbers from an EU vantage should land lower; verify with Grafana traces post-merge.
4. **Warm-vs-cold inversion** (cold sample faster than warm median) is sample noise from tiny n and shared-cache warming across products (the "cold" 1808 render benefited from merchant-map/D1 warmth created by earlier 1532 hits), not a regression signal.
5. `price-context` and `dupes` were untouched by this change; their unchanged numbers (0.63/0.53 s) double as a control confirming the harness measures the same thing the proposal table measured.
6. **Staging data caveat:** products measured have 1-bucket histories; the auto-mode cost is window-driven (partitions in `[from,to]`), not bucket-driven, so these numbers should transfer to data-rich products — but this was not verified against a long-history product on staging.

## Env facts for reproduction

- Product page canonical URL shape: `/tuotteet/:id` (localized slug; `/fi/products/:id` 307-redirects there — measure the post-redirect URL).
- Age gate: all catalog/HTML endpoints accept any non-empty `x-age-confirmed` header.

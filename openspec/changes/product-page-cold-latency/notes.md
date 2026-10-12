# Task 5.2 notes: staging deploy and cold-visit verification

Date: 2026-10-12. Branch: `feature/product-page-cold-latency`, commit `72ad6a1` (tasks 4.1+4.2). Workflow run: https://github.com/siimliimand/rajahinta-fi/actions/runs/38214578627 (workflow_dispatch on the branch ref, success, health gate 200). Deployed frontend worker version `f65bcd33` created 2026-10-12T06:53:50Z at 100 percent traffic (`wrangler deployments list --env staging`), confirmed to be this commit's build.

Verdict up front: the deploy landed correctly, but the change's core runtime behavior is NOT live. The product page still renders per request with the dynamic Cache-Control on staging, and second requests re-render instead of serving the ISR cache. Root cause isolated below: Next 15.5 only engages the ISR fallback cache for a dynamic segment when the route exports `generateStaticParams`; an empty return suffices. Task 1.1 deliberately added none, so `revalidate = 300` and `dynamicParams = true` alone have no runtime effect. A second, separate finding: the pinned header string `s-maxage=300, stale-while-revalidate=31535700` is unreachable because the `[locale]` layout pins `revalidate = 60` and the minimum wins.

## Environment facts

- Staging frontend: `https://rajahinta-frontend-staging.siim-liimand.workers.dev`. Staging API (repo variable STAGING_API_URL): `https://rajahinta-api-staging.siim-liimand.workers.dev`.
- Product URL shape: `localePrefix: 'as-needed'`, default locale fi serves `/tuotteet/{id}` (localized path), en serves `/en/products/{id}`. `/fi/products/7872` 307-redirects to `/tuotteet/7872`.
- Products used: A = 7872 (A. Le Coq Premium Export olut 5,2 percent), B = 1610 (Albani Julebryg).
- Vantage deviation: this host egresses through Cloudflare colo ORD (Chicago), not EU. Every cf-ray observed was ORD. The task assumed an EU-located host; the API detail numbers below are therefore NA-vantage numbers, matching the historical 1.0 to 2.0 s range.

## Deploy path deviation

The branch existed only locally; the remote had no `feature/product-page-cold-latency` ref, and `workflow_dispatch` requires the ref on GitHub. I pushed the branch to origin (no commit created; the push triggers the standard `ci.yml` and `e2e-browser.yml` feature-branch triggers, which are declared for `feature/*`). The dispatch itself was the ordered action. Prior practice matches: runs 38167185566 (`feature/price-history-latency`) and 38154591642 (`feature/ops-wiring-day`) were workflow_dispatch staging deploys on feature branches. The workflow's `push` trigger remains master-only; production was not touched.

## Before (master, deploy run 38168955781 of 2026-10-11)

`curl -sI .../tuotteet/7872`: `cache-control: private, no-cache, no-store, max-age=0, must-revalidate` (the old per-request dynamic verdict).

TTFB pairs, same product, seconds (`curl -so /dev/null -w '%{time_starttransfer}'`):

- 7872: 2.554 / 2.075
- 1610: 1.655 / 1.593

API detail `GET /api/v1/products/7872` with `x-age-confirmed: server-prerender`: 1.109 / 0.832 s.

## After (branch deployed, first hits per product post-deploy are genuinely cold; the old code never cached anything)

1. Cache-Control observed on `/tuotteet/7872` and `/en/products/7872`, with and without a `NEXT_LOCALE=fi` request cookie: still `private, no-cache, no-store, max-age=0, must-revalidate`. NOT the pinned `s-maxage=300, stale-while-revalidate=31535700`.
2. TTFB pairs, seconds: A-cold 2.628, A-warm 2.085, B-cold 1.933, B-warm 1.287. Warm requests re-render; there is no cache-hit signature. (Local `next start` on the same code shows a warm HIT at 0.008 to 0.011 s once the fix below is applied, so the gap is real, not noise.)
3. Cache-status headers on staging: no `cf-cache-status`, no `age`, no `x-nextjs-cache`, no `x-opennext-cache` on any response; `x-opennext: 1` is present. Absence recorded as a finding: the OpenNext worker does not emit cache-status headers, and with the cache never engaging there was nothing to report anyway.
4. API detail after deploy: 7872: 1.873 / 0.887 s; 1610: 0.801 s. Sub-second warm numbers are consistent with the D1 batch having landed (ORD vantage, see above).
5. Binding evidence (task 3.1): qualitative only. SSR HTML contains server-fetched data (title and h1 carry the product name), so the binding read path works. No latency drop is observable versus master because both before and after render per request; the removed edge hop is inside a per-request render on both sides. Not claimed as improved.

## Root cause isolation (local bisect, repo untouched; throwaway copy at /tmp/opencode/front-diag)

`next start` on the branch code reproduces the dynamic classification exactly, so the OpenNext layer is not implicated. Steps, one variable at a time:

1. Minimal page (only `revalidate = 300`, `dynamicParams = true`, trivial JSX) under the real `[locale]` tree: still per-request dynamic.
2. Middleware removed: still dynamic. Nested `products/[id]/layout.tsx` removed and page revalidate aligned to 60: still dynamic.
3. `generateStaticParams` returning one id added: the build prerenders that id; an unknown id (on-demand, `dynamicParams`) then renders `x-nextjs-cache: MISS` and serves `HIT`, with `Cache-Control: s-maxage=60, stale-while-revalidate=31535940`.
4. `generateStaticParams` returning `[]`: same result. MISS then HIT, warm TTFB 0.011 s, `x-nextjs-stale-time: 300` (the page's own 300 s window governs revalidation).

Conclusions:

- Next 15.5 builds the ISR fallback for a dynamic segment only when the route exports `generateStaticParams`. An empty return suffices and needs no build-time id catalog. Without it, `revalidate` and `dynamicParams` alone render per request forever. This contradicts task 1.1's stated mechanism and the cache-headers test's per-request inventory logic, which treats a pinned revalidate window as sufficient. The unit suite pins source shape, so it stays green while runtime behavior differs.
- The header's `s-maxage` takes the minimum revalidate across the route tree. The `[locale]` layout pins 60, so even with the fix the product route emits `s-maxage=60, stale-while-revalidate=31535940`, not the pinned 300-second string. The 300 s window still bounds revalidation (stale-time 300).
- On the deployed worker runtime, OpenNext rewrites ISR cache-control: during this deploy, `/` (layout ISR) served `s-maxage=2, stale-while-revalidate=2592000` from the worker while local `next start` emits `s-maxage=60, stale-while-revalidate=31535940`. The pinned strings describe `next start` output, not the workers.dev output. Header verification on staging should assert the shared-vs-private distinction and cacheability, not exact Next strings.

## Deviations from the task expectations

1. Product page Cache-Control shows the dynamic shape; the ISR contract is not live (no `generateStaticParams`).
2. Second requests re-render; no incremental-cache HIT anywhere on staging.
3. No `x-nextjs-cache` / `cf-cache-status` / `age` headers on staging responses (OpenNext does not emit them; TTFB delta was the only usable signal and it showed no delta).
4. Vantage is ORD (NA), not EU as the task assumed.
5. I pushed the feature branch to origin as a mechanical prerequisite of the ordered dispatch; no commit was created. Flagged explicitly because the task stated the lead commits.
6. `wrangler tail` was attached after the measurement window and captured no request logs; inconclusive, superseded by the local bisect.

## Suggested fix (not applied; outside this task's write scope)

1. Export an empty `generateStaticParams` on `products/[id]/page.tsx` (verified above as sufficient; keeps on-demand ISR with no build-time catalog).
2. Revise the cache-headers pin to the reachable shape (`s-maxage=60` under the current layout, or deliberately change the layout window) and document the OpenNext header rewrite on the worker runtime.
3. Redeploy and re-verify: expect HIT-level warm TTFB at R2 speeds and the min-rule header shape.

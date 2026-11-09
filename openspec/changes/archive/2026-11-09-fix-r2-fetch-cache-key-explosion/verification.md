# Verification — fix-r2-fetch-cache-key-explosion

Operational and runtime evidence for this change. Task 3.2 appends below; do not rewrite earlier sections.

## Task 3.1 — staging lifecycle rule, deploy, and health (2026-11-09)

### Lifecycle configuration — `rajahinta-frontend-cache-staging` (EU)

Rule `expire-30d` added via:

```
cd apps/frontend
npx wrangler r2 bucket lifecycle add rajahinta-frontend-cache-staging expire-30d --expire-days 30 --jurisdiction eu
```

Wrangler 4.152.0 (frontend-local). Confirmed non-interactive fallback accepted the all-prefixes prompt.

`npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-staging --jurisdiction eu` at 2026-11-09T14:19:26Z:

```
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days

name:     expire-30d
enabled:  Yes
prefix:   (all prefixes)
action:   Expire objects after 30 days
```

Both rules present. `expire-30d` expires objects after 30 days, applies to all prefixes, no deletion of existing objects was performed. No production lifecycle change.

### Staging deploy (normal pipeline)

Workflow `Deploy Staging` (`deploy-staging.yml`) dispatched on the feature branch (repo pattern for pre-merge validation).

- Run ID: `42632988169`
- URL: https://github.com/siimliimand/rajahinta-fi/actions/runs/42632988169
- Branch: `feature/fix-r2-fetch-cache-key-explosion`
- Created: 2026-11-09T14:16:01Z
- Updated (completed): 2026-11-09T14:18:45Z (~2m44s)
- Conclusion: **success**

All steps succeeded: install → workspace packages → D1 migrate (staging) → seed (staging) → API Worker → email Worker → frontend OpenNext build → frontend Worker → health gate. Production was not deployed (`deploy-production.yml` not dispatched).

### Worker health after deploy

Checked 2026-11-09T14:18:59Z–14:19:12Z:

| Target | URL | Status |
|---|---|---|
| Staging API health | `https://rajahinta-api-staging.siim-liimand.workers.dev/api/v1/health` | **200** `{"status":"ok",...}` |
| Staging API ready | `https://rajahinta-api-staging.siim-liimand.workers.dev/api/v1/health/ready` | **200** `{"status":"ok","checks":{"d1":{"status":"up",...},"durableObjects":{"status":"up",...}}}` |
| Staging frontend `/` | `https://rajahinta-frontend-staging.siim-liimand.workers.dev/` | **200** |
| Staging frontend `/fi` | `https://rajahinta-frontend-staging.siim-liimand.workers.dev/fi` | **307** → `Location: /` (locale middleware: Finnish is the unprefixed default; sets `NEXT_LOCALE=fi`). Followed redirect: **200** on `/`. |
| Staging frontend `/en` | `https://rajahinta-frontend-staging.siim-liimand.workers.dev/en` | **200** |

Localized serving is healthy: `/en` answers 200 directly; `/fi` normalising to `/` is the documented middleware behaviour (`apps/frontend/src/middleware.ts`), not a Worker fault.

### State before task 3.2 — staging R2 object sample

Bounded sample only. One `list({ limit: 500 })` via a throwaway remote dev worker bound to `rajahinta-frontend-cache-staging` (`jurisdiction: eu`) — a single billable Class A operation. Not a full-bucket census. Sampled 2026-11-09T14:16–14:17Z, after the lifecycle rule was added and before/around the staging deploy.

- Returned **465** objects (`truncated: true`, so more remain unlisted)
- **331** keys ending `.fetch`
- **134** keys other suffixes (`.cache` and similar)
- Sample keys were `incremental-cache/-74HEgy-Y3qkAIlWSmWmU/...` (hashed incremental-cache entries)

Interpretation: the staging cache bucket still holds a large `.fetch` majority in this first page, consistent with the pre-fix key-explosion pattern. The 30-day expiration will age these out; they were not deleted. Task 3.2 should re-sample after the header fix has been live long enough for new writes to dominate, and should compare `.fetch` growth rather than absolute counts from this one page.

### Operational notes

- No R2 object was listed beyond the single 500-key page above; no object was read, written, or deleted.
- No source file was modified for this task.
- Production buckets and `deploy-production.yml` were not touched.
- Scratch probe (`wrangler.jsonc`, `index.ts`, dev log) used only `.opencode/.tmp/r2probe/` and was deleted after sampling.

## Task 3.2 — staging cache matrix (2026-11-09)

Deploy under test: staging Workers from workflow run `42632988169` (this branch), frontend `rajahinta-frontend-staging`, API `rajahinta-api-staging`, bucket `rajahinta-frontend-cache-staging` (EU). Live frontend deployment: version `6def902c-a55a-4c69-8398-848e6b376330`, created 2026-11-09T14:18:38Z. OpenNext build id of the live cache namespace: `4kB0-5we9il8KWmc_Lmg6`.

### Matrix

| Check | Method | Observed | Verdict |
|---|---|---|---|
| Repeated localized renders within 900 s create no new blog/guide `.fetch` keys | `wrangler tail rajahinta-api-staging` during ~40 localized renders; R2 group of the live build before/after | 0 origin requests for `/api/v1/blog/posts` and `/api/v1/guides` across the burst and the ISR-expired re-renders; 0 new `.fetch` keys after 14:25:06Z | **PASS** |
| Revalidation after 900 s reuses keys | Render at 14:40:20–14:40:37Z after the window from the last fetch write (14:25:06Z); compare live-build `.fetch` key set | 4 origin requests (blog fi/en, guides fi/en); live-build `.fetch` key set identical (23 → 23, 0 added, 0 removed); the active `tags:null` variants were overwritten in place (uploaded 14:40:23–14:40:25Z, same key names) | **PASS** |
| Footer links and publish behavior stay correct | Direct API counts + rendered HTML | API returns `items: 0, total: 0` for blog and guides in both locales; footer blog/guides links are absent on `/` and `/en`; `/blogi`, `/oppaat`, `/en/blog`, `/en/guides` answer 404 (zero-publication `notFound()`); services links still render | **PARTIAL** (hide-on-zero and 404-on-zero observed; links-present-with-content cannot be observed because staging has no PUBLISHED posts or guides) |
| API origin logs carry UUID and trace context | Tail `request completed` lines on the 4 post-window misses | `requestId` is a UUID on each; inbound `x-request-id` **absent**; inbound `traceparent` present in W3C form; direct API call still echoes `x-request-id` | **PASS** |
| On-demand tag revalidation (`POST /api/internal/revalidate`) | Unauthenticated POST | 401 `{"error":"Unauthorized"}`. Authorized path not exercised (secret not used). Dummy tag cache remains the deployed store (task 1.3 / OPENNEXT.md) | **PARTIAL** (endpoint present and auth-gated; tag persistence not demonstrated — and cannot persist on the dummy tag cache) |

### Bounded R2 samples (not a census)

`ListObjects` is Class A. Whole-bucket views below are **one first page of `list({ limit: 1000 })`**, not a full census. The live-build group is a complete listing of that build’s prefix (`truncated: false`, 99 objects).

Whole-bucket first page (lexicographic, old builds dominate):

| Sample | UTC | Objects in page | `.fetch` | other | `truncated` | after-deploy `.fetch` in page |
|---|---|---|---|---|---|---|
| A (pre-burst) | 2026-11-09T14:24Z | 465 | 331 | 134 | true | 0 |
| B (post-burst) | 2026-11-09T14:30Z | 465 | 331 | 134 | true | 0 |

Page A → B: **0 keys added, 0 removed**. Upload range in this page: 2026-10-07T05:23Z – 2026-11-03T08:47Z. Identical counts to the task 3.1 `limit: 500` sample (465 / 331 / 134). New writes under the live build sort outside this first page; they are counted in the live-build group below.

Live build `incremental-cache/4kB0-5we9il8KWmc_Lmg6/` (complete, not truncated):

| Time (UTC) | `.fetch` | other | listed |
|---|---|---|---|
| 14:32Z (pre-900 s) | 23 | 76 | 99 |
| 14:41Z (post-900 s render) | 23 | 76 | 99 |

`.fetch` keys grouped by stored `data.url` (design D5), live build:

| URL (path) | keys |
|---|---|
| `/api/v1/guides?locale=en` | 3 |
| `/api/v1/blog/posts?locale=fi` | 3 |
| `/api/v1/blog/posts?locale=en` | 3 |
| `/api/v1/guides?locale=fi` | 2 |
| `/api/v1/calendar/next?language=fi` / `en` | 2 / 2 |
| `/api/v1/savings/overview`, `/api/v1/savings/top` | 2 / 2 |
| others (products/ids, lists, one `null`, one wasm data-URI) | 1 each |

Contrast with the pre-fix pattern: a 32-object peek of the 2026-10-07 namespace was **all** blog/guides duplicates of the same four URLs written within one minute. The live build holds **2–3** keys per blog/guides URL, not one per render.

Revalidation key identity (live build, blog/guides only): every `.fetch` key present after the 900 s render was already present before it. The three `tags:null` variants that our renders actually revalidated were re-uploaded at the same key:

- `/api/v1/blog/posts?locale=fi` `…91f9de5d70.fetch` uploaded 14:23:20.205Z → 14:40:23.769Z
- `/api/v1/guides?locale=fi` `…380c63a181.fetch` uploaded 14:23:20.201Z → 14:40:23.784Z
- `/api/v1/blog/posts?locale=en` `…428b53952f.fetch` uploaded 14:25:06.646Z → 14:40:25.218Z
- `/api/v1/guides?locale=en` `…066e1fbd…d4e4.fetch` uploaded 14:25:06.721Z → 14:40:25.214Z

The `tags:["blog"]` / `tags:["guides"]` / `tags:[]` variants from 14:18:27Z were not rewritten at 14:40Z (those entries were not the shape the test renders used after the window). They are a small, stable set, not per-render growth.

### API origin volume during the repeat burst

`wrangler tail rajahinta-api-staging --format json` (no `--sampling-rate`).

Burst 14:28:18–14:28:34Z: 30 localized renders (`/`, `/en`, `/laskuri`, `/en/calculator`, `/jarjestys`, `/en/ranking`, `/skenaario`, `/en/what-if`, `/vertailu`, `/en/compare` × 3). Origin requests for blog/guides: **0 / 0**.

ISR-expired renders 14:30:07Z (pages answered `x-nextjs-cache: STALE`, so the localized tree did re-render): origin requests for blog/guides: **0 / 0**. That is the data-cache hit the fix is supposed to produce: the page re-ran, the footer fetch reused the existing entry.

Post-900 s renders 14:40:20–14:40:37Z (`/`, `/en`, `/laskuri`, `/en/calculator`, all `x-nextjs-cache: STALE`): origin requests **2 blog + 2 guides**, one per locale per path — the expected cold miss after the window, not one per render.

### Origin miss evidence (post-900 s)

Frontend → API went over the **public API URL** (`https://rajahinta-api-staging.siim-liimand.workers.dev`), not the `API_WORKER` service binding. `getServerBlogIndex` / `getServerGuidesIndex` use `request()` from `lib/api.ts`, which is the URL path. The binding path (`serverRequest`) is the product/sitemap readers. Inbound headers below are what the API Worker saw.

| URL | `requestId` (API log) | inbound `x-request-id` | inbound `traceparent` |
|---|---|---|---|
| `GET /api/v1/blog/posts?locale=fi` | `d155c02a-5eb9-4477-9dbc-120ab1c15fed` | **absent** | `00-50b7ca7a2b5cec82ab9ac6001f79068f-8d5ad2249dfc963d-01` |
| `GET /api/v1/guides?locale=fi` | `67e6d7b4-a7a4-479d-b692-32ef4ac2a14f` | **absent** | `00-71ae122db5450340d6f08a9984e14460-fc9f0c23841a52c5-01` |
| `GET /api/v1/blog/posts?locale=en` | `811f1a29-6880-421f-b38f-0d490ab84fea` | **absent** | `00-77d8bbff990f0b54bdeb2006008e43b0-d81923504a2ddc53-01` |
| `GET /api/v1/guides?locale=en` | `37e30ccb-6971-4922-95cc-3a33ea0cf6ad` | **absent** | `00-3c204155a950fe7ebcc416c10e5949c6-513e0446d889809a-01` |

All four `requestId` values are UUIDs assigned by `request-id.ts` because the frontend omitted a generated `x-request-id` on these positive-revalidate reads. All four `traceparent` values match `00-<32hex>-<16hex>-01`. Status 200 on each.

Direct API call still echoes an assigned ID (14:41Z): `x-request-id: 3bd00573-f944-4a6c-afa3-bf907f5d3df2`.

### Footer links and publish behavior

Staging API public counts at 14:24Z (direct, no cache):

```
GET /api/v1/blog/posts?locale=fi  → items 0, total 0
GET /api/v1/blog/posts?locale=en  → items 0, total 0
GET /api/v1/guides?locale=fi      → items 0, total 0
GET /api/v1/guides?locale=en      → items 0, total 0
```

Rendered HTML:

- `/` and `/en`: **no** `href` matching blog or guides. Footer services/about links present (`/en/calculator`, `/en/ranking`, `/en/about`, `/en/contact`, …).
- `/blogi`, `/oppaat`, `/en/blog`, `/en/guides`: **404**. The index routes call `notFound()` on zero PUBLISHED items (`blog/page.tsx`, honest-trust-surfaces 4.1).

That is the documented visibility rule (hide the link when the index read is unavailable or empty; 404 the index page on zero publications). A broken cache or failed origin read would produce the same hide — so hide-on-zero is necessary but not sufficient to prove the fetch succeeded. The origin 200s on the post-window misses (above), and the presence of cached `items: []` bodies in `.fetch` objects, are the evidence the reads themselves work. The “link present when content exists” half of the check was **not** observable: staging has no PUBLISHED posts or guides, and this task did not publish any.

`POST /api/internal/revalidate` without `x-revalidate-token`: **401** `{"error":"Unauthorized"}`. The authorized path was not called. Per OPENNEXT.md and task 1.3, no `NEXT_TAG_CACHE_*` binding is deployed; `revalidateTag` would answer 200 and still not persist. Time-based ISR remains the effective freshness mechanism, which is what the 900 s window test exercised.

### What this proves and what it does not

**Proves** (staging, this deploy, 14:22–14:41Z):

- Positive-revalidate blog/guides reads no longer mint a `.fetch` key per render. ~40 localized re-renders inside 900 s produced **zero** new blog/guides `.fetch` keys and **zero** origin requests, including when page-level ISR was stale and the footer actually re-ran.
- After 900 s the next render refreshed the **same** keys (0 added, 0 removed; in-place overwrite of the `tags:null` variants). Origin was hit once per (path, locale), not once per render.
- On those misses the API Worker assigned a UUID `requestId`, the inbound request carried a W3C `traceparent`, and it did **not** carry a frontend-generated `x-request-id`.
- Footer hide-on-zero, index 404-on-zero, and API `x-request-id` echo on direct (non-cached) calls are unchanged.
- The 30-day lifecycle rule from task 3.1 was not contradicted; no object was deleted.

**Does not prove:**

- Full-bucket object count. Whole-bucket views are one 1000-key first page (`truncated: true`, 465 returned). The live-build prefix was complete (99 objects) and is the meaningful post-fix namespace; old builds still hold the historical duplicates and will age out under `expire-30d`.
- Exactly one cache key per URL. The live build has 2–3 keys per blog/guides URL, corresponding to different Next fetch-option shapes (`tags: ['blog']` / `['guides']` vs untagged). That is not per-render explosion. Unifying those shapes was not in scope.
- Tag-cache persistence. Dummy tag cache is still what is deployed; the revalidate endpoint was not invoked with its secret.
- Footer links present with published content. Staging has zero PUBLISHED posts and guides.
- The `API_WORKER` service-binding path for blog/guides. Those reads use the public URL. Binding-path cache semantics are out of scope of this matrix (the binding bypasses Next’s fetch cache).
- Production, 24-hour PutObject volume, or the ~35k/day baseline — that is task 4.2.

### Operational notes

- No R2 object was read beyond the bounded peeks named above (~80 Class B `GET`s on `.fetch` payloads to extract `data.url`, plus the listing `GET`s). No object was written by the probe, and **no object was deleted**.
- List operations: whole-bucket first page at sample A and B; one delimiter listing of build-id prefixes; complete prefix listing of the live build before and after the 900 s window. Not a full-bucket census.
- Production buckets, production URLs, and `deploy-production.yml` were not touched.
- No source file was modified. Scratch probe lived only in `.opencode/.tmp/r2cache/` and was deleted after sampling.
- Cloudflare token was used inline via `$(cat /root/.cloudflare-token)` and was never printed.
- Measurement timestamps (UTC): sample A 14:24Z; burst 14:26:36–14:26:48Z and 14:28:18–14:28:34Z; ISR-expired renders 14:30:07Z; live-build group 14:32Z; post-900 s renders 14:40:20–14:40:37Z; sample C 14:41Z.

## Task 4.1 — production lifecycle rule and gated deploy (2026-11-09)

### Gate confirmed before any production action

Task 3.2 was read first. Nothing in that evidence contradicted “staging is green”:

- Staging deploy run `42632988169` (Deploy Staging on `feature/fix-r2-fetch-cache-key-explosion`) — **success**.
- Staging lifecycle rule `expire-30d` present on `rajahinta-frontend-cache-staging` (EU).
- ~40 localized re-renders inside 900 s: **0** origin requests for `/api/v1/blog/posts` and `/api/v1/guides`, **0** new `.fetch` keys.
- After the window the same keys were refreshed in place (0 added, 0 removed).
- On the origin misses the API Worker assigned a UUID `requestId`, inbound `traceparent` was present, inbound `x-request-id` was absent.

Production was only dispatched after that confirmation. Local `main`-side verification from the lead session (154 test files / 1918 tests, typecheck, eslint, OpenNext build) was taken as given and not re-run.

### Production lifecycle configuration — `rajahinta-frontend-cache-production` (EU)

Rule added via the frontend’s own Wrangler 4.152.0 (`apps/frontend/node_modules`), token used inline and never printed:

```
cd apps/frontend
npx wrangler r2 bucket lifecycle add rajahinta-frontend-cache-production expire-30d --expire-days 30 --jurisdiction eu
```

Non-interactive fallback accepted the all-prefixes confirmation (same as task 3.1). Added 2026-11-09T14:43:03–14:43:06Z.

`npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-production --jurisdiction eu` at 2026-11-09T14:43:08Z:

```
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days

name:     expire-30d
enabled:  Yes
prefix:   (all prefixes)
action:   Expire objects after 30 days
```

Both rules present. `expire-30d` expires objects after 30 days from upload, all prefixes, EU jurisdiction. The pre-existing ~213,769 production cache objects (~152,987 of them `.fetch`) were **not** listed, read, rewritten, or deleted; they age out under the rule and regenerate from source on the next request. **NO BULK DELETION was performed.**

### Gated production deploy

Workflow `Deploy Production` (`deploy-production.yml`) dispatched on the feature branch (established repo pattern for a pre-merge change; previous example run `41415070153` on `feature/fix-opennext-adapter-cache-regression`).

- Run ID: `42637429328`
- URL: https://github.com/siimliimand/rajahinta-fi/actions/runs/42637429328
- Branch: `feature/fix-r2-fetch-cache-key-explosion`
- Event: `workflow_dispatch`
- `confirm_deploy` input: `yes`
- Created: 2026-11-09T14:43:15Z
- Updated (completed): 2026-11-09T14:45:40Z (~2m25s)
- Conclusion: **success**

Per-step outcome (deploy job `Production deploy (gated, migrate → deploy)`):

| Step | Outcome |
|---|---|
| Require confirmation | skipped (correct: the gate step only runs when `confirm_deploy != 'yes'`) |
| checkout / pnpm / node / install | success |
| Apply D1 migrations (production) | success |
| Deploy API Worker (production) | success |
| Deploy email Worker (production) | success |
| Build frontend (OpenNext) | success |
| Deploy frontend Worker (production) | success |
| Health gate — production readiness | success |

Rollback job `Rollback availability (wrangler rollback)`: **success** (2026-11-09T14:45:36–14:45:40Z). No rollback was executed.

### Post-deploy health and headers

| Target | URL | UTC | Status | Notable headers / body |
|---|---|---|---|---|
| Production API health | `https://api.rajahinta.fi/api/v1/health` | 14:45:51Z | **200** | `{"status":"ok",...}` |
| Production API ready | `https://api.rajahinta.fi/api/v1/health/ready` | 14:45:52Z | **200** | `{"status":"ok","checks":{"d1":{"status":"up",...},"durableObjects":{"status":"up",...}}}` |
| Production frontend `/` | `https://rajahinta.fi/` | 14:45:51Z | **200** | `cache-control: s-maxage=16, stale-while-revalidate=2592000`; `x-nextjs-cache: HIT`; `x-nextjs-prerender: 1,1` |
| Production frontend `/en` | `https://rajahinta.fi/en` | 14:45:58Z | **200** | `cache-control: s-maxage=14, stale-while-revalidate=2592000`; `x-nextjs-cache: HIT`; `x-nextjs-prerender: 1,1` |
| Localized product listing | `https://rajahinta.fi/tuotteet` | 14:45:52Z / 14:46:16Z | **200** | `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`; `x-nextjs-cache` / `x-nextjs-prerender` **not present**; HTML 218,483 bytes |

### Product-page render check — `/tuotteet`

**PASS.** 24 `<article class="rounded-lg border …">` product cards, each linking to `/tuotteet/{id}` with server-rendered product titles (examples: Hendrick’s Another Gin 41,4% 700ml → `/tuotteet/19`; L’Oratoire des Papes Chateauneuf Du Pape Rouge 15% 0.75 l → `/tuotteet/1`; Crystal Head Vodka 40,0% 1,75L → `/tuotteet/3550`). This is live catalog content, not a degraded ISR bake.

### Rollback availability

The deploy job versioned the previous Worker scripts. The prior deployment of each Worker remains instantly restorable. **No rollback was run.** Commands (from the repo root; the workflow’s rollback job printed the same runbook):

```
pnpm --filter @rajahinta/api-worker     exec wrangler rollback --env production
pnpm --filter @rajahinta/email-worker   exec wrangler rollback --env production
pnpm --filter @rajahinta/frontend       exec wrangler rollback --env production
```

The R2 lifecycle rule is **not** touched by a Worker rollback: `wrangler rollback` restores the previous Worker script and its bindings, not bucket lifecycle configuration. `expire-30d` may stay in place during a rollback — it only expires regenerable cache objects.

### Operational notes

- **No R2 object was deleted**, in any bucket, in any way. No bucket purge, no bulk deletion, no object write or read by this task. Existing production cache objects age out under `expire-30d`.
- No source file was modified. Only this section was appended to `verification.md`.
- Nothing was committed to git (lead session commits).
- Cloudflare token was used inline via `$(cat /root/.cloudflare-token)` and was never printed, copied, or logged.
- `deploy-production.yml` was not modified; the confirmation gate was not bypassed.
- Measurement timestamps (UTC): lifecycle add 14:43:03–14:43:06Z; lifecycle list 14:43:08Z; dispatch 14:43:14Z; run 14:43:15–14:45:40Z; API health 14:45:51Z; API ready 14:45:52Z; `/` 14:45:51Z; `/en` 14:45:58Z; `/tuotteet` 14:45:52Z and 14:46:16Z.
- 24-hour PutObject / duplicate-key follow-up is task 4.2 and was **not** started.

## Task 4.2 — production verification, immediate portion (2026-11-09)

Deploy under test: production Workers from workflow run `42637429328` (this branch), frontend `rajahinta-frontend-production`, API `rajahinta-api-production`, bucket `rajahinta-frontend-cache-production` (EU). Live frontend deployment from **2026-11-09T14:45:11Z**. Live cache namespace of that build: `incremental-cache/0tFvUE63ML6ljsBMGi8Ux/` (superseded by the post-merge deploy — see the 24-hour follow-up section).

The 24 h window has **not** elapsed. Everything below is the immediate portion (~14:45–15:30Z, under one hour post-deploy). No 24-hour measurement is claimed. See the pending subsection at the end.

### Immediate results

| Metric | Measurement | Source | Verdict |
|---|---|---|---|
| Pre-fix `.fetch` write rate (live-then namespace `tAlbcB9w6O0zY9sZK02ZT`, 24 h before deploy) | **23,133** `.fetch` / 33,961 objects → **964 `.fetch`/h ≈ 23,133/day** | Lead-session bounded scan of that namespace (not re-run; billable) | baseline |
| Bucket-wide daily objects, trailing weeks | **8,401–59,462**, mean **~35k/day** (31 build namespaces, 1,853 ListObjects) | Lead-session census — **not re-run** | baseline (see caveat below) |
| Post-fix `.fetch` rate at 15:24Z (lead) | 32 `.fetch` / 449 objects in ~0.6 h ≈ **49/h ≈ 1,280/day** | Lead-session live-namespace listing | **PASS** (~18× vs 23k/day; ~27× vs 35k/day) |
| Post-fix `.fetch` rate at 15:29Z (independent re-read) | **32 `.fetch` / 460 objects** over 0.735 h ≈ **44/h ≈ 1,045/day**; **0 new `.fetch` keys** vs the 15:24Z snapshot | This session, one complete prefix listing (`truncated: false`) | **PASS** (~22× vs 23k/day; ~33× vs 35k/day) |
| Per-URL blog/guides `.fetch` keys (post-fix namespace, 15:27Z) | `/api/v1/blog/posts?locale=fi` **3**, `?locale=en` **3**, `/api/v1/guides?locale=fi` **3**, `?locale=en` **3** (plus one unrelated post-detail URL) | `bodies=1` on the live namespace (32 Class B `GET`s) | **PASS** — 2–3 fetch-option shapes per URL, not per-render growth |
| Origin `/api/v1/blog/posts` and `/api/v1/guides` during a 20-render burst of `/` and `/en` | **0 and 0** | `wrangler tail rajahinta-api-production`, burst 15:28:27–15:29:06Z | **PASS** |
| Content freshness `/tuotteet` vs live API (ids 19, 1, 3550) | 1,29 € = 129 ¢; 32,90 € = 3290 ¢; 99,96 € = 9996 ¢ | Rendered HTML vs `GET /api/v1/products/{id}` with `x-age-confirmed: server-prerender` | **PASS** |
| Lifecycle `expire-30d` on `rajahinta-frontend-cache-production` (EU) | Still present, all prefixes, expire after 30 days; multipart-abort rule unchanged | `wrangler r2 bucket lifecycle list` | **PASS** |

The ~35k/day bucket-wide baseline was measured by the lead session’s bounded census. **The live-namespace `.fetch` write rate is the metric that shows the change**; the bucket-wide total still contains the historical pre-fix duplicates and will not fall until `expire-30d` ages them out.

### Independent re-verification (this session)

The lead session’s immediate numbers were not re-derived from a new census. Four bounded checks were re-run.

**1. Live-namespace re-read.** `incremental-cache/0tFvUE63ML6ljsBMGi8Ux/` (complete, one page, `truncated: false`):

| Time (UTC) | objects | `.fetch` | notes |
|---|---|---|---|
| 15:24:39Z (lead snapshot) | 449 | 32 | lead session |
| 15:27:18Z (re-read) | 452 | 32 | +3 objects, **+0 `.fetch` keys**; 1 existing `.fetch` overwritten in place (uploaded 14:46:01.011Z → 15:25:30.591Z) |
| 15:29:19Z (after burst) | 460 | 32 | +11 objects vs lead, still **+0 `.fetch` keys**; `latest_fetch` still 15:25:30.591Z |

Derived rate over the full post-deploy window (14:45:11 → 15:29:18, 0.735 h): 32 `.fetch` = **43.5/h**, extrapolated **~1,045/day**. Hourly split: 14:xx 19 `.fetch`, 15:xx 13 `.fetch`. Write rate is still tens-per-hour, not the hundreds the pre-fix namespace produced (1,045 `.fetch` in a single 15-minute bucket there).

**2. Repeat-render burst.** 20 renders (10× `https://rajahinta.fi/`, 10× `/en`), all HTTP 200, 15:28:27–15:29:06Z, `wrangler tail rajahinta-api-production --format json` (no `--sampling-rate`).

Origin paths observed: **`/api/v1/blog/posts` 0, `/api/v1/guides` 0**. The only logged origin traffic was the homepage’s `API_WORKER` binding reads of featured products:

```
/api/v1/products/2263            4
/api/v1/products/2264            4
/api/v1/products/2265            3
/api/v1/products/2263/dupes      2
/api/v1/products/2263/price-history  2
/api/v1/products/2263/price-context  2
/api/v1/products/2264/dupes      2
/api/v1/products/2264/price-context  2
/api/v1/products/2264/price-history  2
```

23 logged requests, 23 unique UUID `requestId`s. Every one of those binding reads carried an explicit `x-request-id` equal to the API’s echo and a W3C `traceparent` — the binding path is untouched, as designed. `savings/*` and `calendar/*` did not appear in this burst (data-cache hit; the lead session had already exercised them). Blog/guides reads went through `apiFetch` and were served from the data cache.

**3. Freshness re-check.** `GET https://rajahinta.fi/tuotteet` at ~15:27Z: 24 server-rendered `<article>` cards. Same three ids as the lead session:

| id | Rendered name | Rendered price | Live API (`x-age-confirmed: server-prerender`) | Match |
|----|---------------|----------------|------------------------------------------------|-------|
| 19 | Hendrick’s Another Gin 41,4% 700ml | **1,29 €** | `currentBestPriceCents: 129` = 1,29 € | ✅ |
| 1 | L’Oratoire des Papes Chateauneuf Du Pape Rouge 15% 0.75 l | **32,90 €** | `currentBestPriceCents: 3290` = 32,90 € | ✅ |
| 3550 | Crystal Head Vodka 40,0% 1,75L | **99,96 €** | `currentBestPriceCents: 9996` = 99,96 € | ✅ |

**4. Lifecycle re-check.** `npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-production --jurisdiction eu` at ~15:27Z:

```
name:     Default Multipart Abort Rule
enabled:  Yes
prefix:   (all prefixes)
action:   Abort incomplete multipart uploads after 7 days

name:     expire-30d
enabled:  Yes
prefix:   (all prefixes)
action:   Expire objects after 30 days
```

Per-URL `.fetch` shape in the live namespace (15:27Z) is the same 2–3 fetch-option shapes per blog/guides URL the lead session saw, not per-render growth. Tag census on those 32 `.fetch` bodies: `tags:null` ×17, `tags:[]` ×11, `tags:["blog"]` ×2, `tags:["guides"]` ×2.

### Post-merge production deploy and namespace re-baseline (2026-11-09T16:12Z)

The change was merged to master (PR #162, merge commit `68429da3`) and the post-merge production deploy ran from master HEAD.

| Item | Value |
|---|---|
| Production deploy run | `42652029033` (`Deploy Production`, `master`, `68429da3`, `confirm_deploy=yes`) — success, 16:10:19Z |
| Rollback availability job | success (no rollback executed) |
| Runtime delta vs the earlier live build | **none** — `git diff b984aa96..68429da3 -- apps/ packages/` is empty; only the archive move, three spec updates, and the ARCHITECTURE.md/guardrails edits differ |
| Health after deploy | `api.rajahinta.fi/api/v1/health` 200, `/api/v1/health/ready` 200, `rajahinta.fi/` 200, `rajahinta.fi/en` 200 |
| Live cache namespace | **`incremental-cache/o1CU5Tx75fTT0JYN8ETai/`** (new build id) |
| Namespace opened | 2026-11-09T16:12:16Z — 127 objects / 19 `.fetch` in the first two minutes |
| Per-URL `.fetch` shape (16:14Z) | blog/posts `?locale=fi` 3, `?locale=en` 3, guides `?locale=fi` 3, `?locale=en` 3 — the same 2–3 fetch-option shapes per URL |
| Tag census (19 `.fetch` bodies) | `tags:[]` ×11, `tags:null` ×4, `tags:["blog"]` ×2, `tags:["guides"]` ×2 |
| 40-render burst (16:15–16:16Z) | 181 origin requests logged, **0** for `/api/v1/blog/posts`, **0** for `/api/v1/guides`; 181 unique UUID request IDs assigned by the API Worker |
| Freshness | `/tuotteet` rendered 24 articles; 1,29 € / 32,90 € / 99,96 € matching live API 129 / 3290 / 9996 ¢ |
| Lifecycle | `expire-30d` still present on `rajahinta-frontend-cache-production` (30-day expiration, all prefixes) |

The new namespace reproduces the fixed behaviour on the merged build: the per-URL key counts stay at 3 each, and a 40-render burst produces zero blog/guides origin requests.

### 24-hour follow-up (pending, window opens 2026-11-10T16:12Z)

**The 24 h window has not elapsed. NO 24-hour measurement is claimed.** Deploy t₀ = **2026-11-09T16:12:16Z** (post-merge production deploy, run `42652029033`, master HEAD `68429da3`). A follow-up session after **2026-11-10T16:12Z** must re-run the four checks below and compare against the baselines in this section. Precedent: `openspec/changes/archive/2026-11-02-fix-opennext-adapter-cache-regression/verification.md` § “PENDING (24–48 h)”.

> **Namespace re-baseline (2026-11-09T16:14Z).** The post-merge deploy from master HEAD minted a NEW Next build id, so the live cache namespace moved from `incremental-cache/o1CU5Tx75fTT0JYN8ETai/` (the pre-merge feature-branch build) to **`incremental-cache/o1CU5Tx75fTT0JYN8ETai/`**. Every command and namespace reference below points at the NEW namespace. The old namespace is frozen (no further writes) and will age out under `expire-30d`. The runtime code is identical between the two builds (`git diff b984aa96..68429da3 -- apps/ packages/` is empty: only the archive move, the three spec updates, and the ARCHITECTURE.md/guardrails edits differ), so the pre-merge measurements above remain valid evidence for the same runtime — but they are NOT a 24-hour measurement of the new namespace. The new namespace opened at **2026-11-09T16:12:16Z** with 127 objects / 19 `.fetch` in its first two minutes; the 24-hour count must start from that t₀.

Re-run commands (dev worker already at `.opencode/.tmp/r2prod/`; restart it if it is not answering on `127.0.0.1:8796`):

```
# 0. dev worker (skip if already answering)
cd /var/www/code.webuilder.dev/rajahinta-fi/.opencode/.tmp/r2prod
CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)" \
  setsid nohup npx wrangler dev --remote --port 8796 --ip 127.0.0.1 --log-level error \
  > dev.log 2>&1 < /dev/null &
sleep 50
curl -s -A "curl/8.18.0" "http://127.0.0.1:8796/?prefix=incremental-cache/o1CU5Tx75fTT0JYN8ETai/&limit=1000"

# 1. live-namespace listing (complete prefix; do NOT census the whole bucket)
#    paginate with cursor if truncated; count .fetch and total
# 2. per-URL breakdown
curl -s -A "curl/8.18.0" \
  "http://127.0.0.1:8796/?prefix=incremental-cache/o1CU5Tx75fTT0JYN8ETai/&limit=1000&bodies=1"

# 3. burst + tail
cd /var/www/code.webuilder.dev/rajahinta-fi/apps/frontend
CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)" \
  setsid nohup npx wrangler tail rajahinta-api-production --format json \
  > /tmp/prod-tail-24h.json 2>&1 < /dev/null &
sleep 30
# 20 renders of https://rajahinta.fi/ and /en, then:
pkill -f "wrangler tail rajahinta-api-production"

# 4. freshness
curl -s -A "curl/8.18.0" https://rajahinta.fi/tuotteet
curl -s -A "curl/8.18.0" -H "x-age-confirmed: server-prerender" \
  https://api.rajahinta.fi/api/v1/products/19
curl -s -A "curl/8.18.0" -H "x-age-confirmed: server-prerender" \
  https://api.rajahinta.fi/api/v1/products/1
curl -s -A "curl/8.18.0" -H "x-age-confirmed: server-prerender" \
  https://api.rajahinta.fi/api/v1/products/3550

# 5. lifecycle (read-only)
cd apps/frontend && CLOUDFLARE_API_TOKEN="$(cat /root/.cloudflare-token)" \
  npx wrangler r2 bucket lifecycle list rajahinta-frontend-cache-production --jurisdiction eu
```

Helper scripts from this session (may still exist): `.opencode/.tmp/task42/live_now.py` (live-namespace listing / `--bodies`), `.opencode/.tmp/r2prod/tail.py` (tail parser). Reuse them; do not rewrite the worker.

**Baselines to compare against** (from this section, not to be re-censused):

- Pre-fix live-namespace `.fetch`: **23,133/day** (964/h) in `tAlbcB9w6O0zY9sZK02ZT`.
- Bucket-wide mean: **~35k objects/day** (lead census; do not repeat).
- Immediate post-fix live namespace at 15:29Z (pre-merge build `0tFvUE63ML6ljsBMGi8Ux/`): **32 `.fetch` / 460 objects**, ~44 `.fetch`/h, ~1,045/day extrapolated.
- **t₀ baseline for the 24 h window — the live namespace `incremental-cache/o1CU5Tx75fTT0JYN8ETai/` at 16:14Z: 19 `.fetch` / 127 objects, first two minutes of the new build.** Per-URL blog/guides keys: **3 / 3 / 3 / 3**. Tag census: `tags:[]` ×11, `tags:null` ×4, `tags:["blog"]` ×2, `tags:["guides"]` ×2.
- Burst origin blog/guides: **0 / 0** (40 renders, 181 origin requests on other paths).
- Freshness: 1,29 € / 32,90 € / 99,96 € matching 129 / 3290 / 9996 ¢.

**A 24 h PASS looks like:**

- Live namespace `incremental-cache/o1CU5Tx75fTT0JYN8ETai/` `.fetch` count over the full 24 h is in the **low hundreds** (not the ~23k the pre-fix namespace wrote in the same span). Order-of-magnitude cut, not a single-digit count (ISR revalidations and the 900 s footer window will still write).
- Per-URL blog/guides key counts are still **~2–3 each** (the `tags:["blog"]` / `["guides"]` / `[]` / `null` shapes). A count that grows with render volume is a FAIL.
- Repeat-burst origin counts for `/api/v1/blog/posts` and `/api/v1/guides` are still **0** (or, if the 900 s window has just expired, **one** request per (path, locale), not one per render).
- Freshness spot-check on ids 19, 1, 3550 still matches the live API.
- `expire-30d` is still present.

**Interaction with the 30-day lifecycle rule.** `expire-30d` expires objects 30 days after upload. The pre-fix duplicates (including the ~133k `.fetch` in `tAlbcB9w6O0zY9sZK02ZT/` and the other 30 historical namespaces) age out on their own. A raw total-object count of the bucket will **keep growing for weeks** before it declines. The 24 h metric to compare is the **LIVE namespace’s write rate and the per-URL key counts**, NOT the bucket-wide total. Do not purge, and do not re-run the full census to “check progress.”

### What this proves and what it does not

**Proves** (production, this deploy, 14:45–15:30Z):

- The fetch-cache key for blog/guides reads is **stable** on production. The live namespace holds **2–3 keys per blog/guides URL** (different Next fetch-option shapes), not a key per render. A 20-render burst of `/` and `/en` produced **zero** new `.fetch` keys and **zero** origin requests for `/api/v1/blog/posts` and `/api/v1/guides`.
- The `.fetch` write rate in the live namespace dropped by roughly **an order of magnitude** on production: ~44/h (~1,045/day extrapolated) vs the pre-fix **964/h (23,133/day)** in the then-live namespace, and vs the **~35k/day** bucket-wide mean. That is ~22× vs the pre-fix live-namespace rate and ~33× vs the 35k/day mean.
- Content is fresh: `/tuotteet` server-rendered prices match the live API on the same three products the lead session checked.
- `expire-30d` is in place. The `API_WORKER` binding path still carries `x-request-id` + `traceparent`. No object was deleted.

**Does not prove:**

- That the rate holds over **24 hours**. The window has not elapsed. ISR revalidations, a full day of crawler traffic, and tag revalidations could change the absolute count; the per-URL key counts are the invariant to watch.
- A fall in the **bucket-wide total**. Historical pre-fix objects remain until the 30-day rule expires them. Comparing tomorrow’s whole-bucket object count to today’s is the wrong test.
- Exactly one cache key per URL. Unifying the `tags` / no-tags fetch-option shapes was not in scope.
- Tag-cache persistence. Dummy tag cache is still what is deployed; the revalidate endpoint was not invoked with its secret.
- The ~35k/day census itself. It was taken once by the lead session and is treated as given. Re-running it would be another billable Class A sweep for no additional signal.

### Operational notes

- **No R2 object was deleted**, in any bucket, in any way. No bucket purge, no bulk deletion. Existing production cache objects age out under `expire-30d`.
- **No full-bucket census was re-run.** Listings were confined to the live namespace `incremental-cache/0tFvUE63ML6ljsBMGi8Ux/` (three complete prefix listings + one `bodies=1` pass, ~32 Class B `GET`s on `.fetch` payloads) plus a one-object health peek. Not a census.
- No source file was modified. Only this section was appended to `verification.md`.
- Nothing was committed to git (lead session commits).
- Nothing was deployed. Lifecycle rules were only listed, never written.
- Cloudflare token was used inline via `$(cat /root/.cloudflare-token)` and was never printed, copied, or logged.
- Measurement timestamps (UTC): live-namespace re-read 15:27:18Z; bodies pass 15:27Z; freshness ~15:27Z; lifecycle list ~15:27Z; burst 15:28:27–15:29:06Z (tail start 15:27:57Z); post-burst live-namespace 15:29:19Z.
- The throwaway remote dev worker from the lead session (`.opencode/.tmp/r2prod/`, port 8796) was reused, not restarted. Scratch from this session lives only in `.opencode/.tmp/task42/`.


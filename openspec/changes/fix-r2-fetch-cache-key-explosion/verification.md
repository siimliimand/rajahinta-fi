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


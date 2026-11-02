# Verification — post-deploy (immediate portion, task 4.2)

Change: `fix-opennext-adapter-cache-regression`
Production deploy: GitHub Actions run **41415070153** ("Deploy Production"),
created 2026-11-02T08:42:53Z, completed 2026-11-02T08:45:18Z (conclusion: success).
Checks performed: 2026-11-02 **08:48–08:53 UTC** (~3–8 min post-deploy).
Targets: https://rajahinta.fi (frontend, `rajahinta-frontend-production`), https://api.rajahinta.fi (API).

---

## 1. `/fi/products` staleness spot-check vs live API — **PASS**

`GET https://rajahinta.fi/tuotteet` returns fully server-rendered product cards
(24 `<article>` cards in the HTML — no client-fetch dependency for catalog data).

Live API read: `GET https://api.rajahinta.fi/api/v1/products/{id}` with the fixed
first-party prerender age header (same header the SSR reader in
`apps/frontend/src/lib/server-api.ts` sends on every binding read).

| id | Rendered name (`/tuotteet`) | Rendered price | Live API name | Live API min offer | Match |
|----|------------------------------|----------------|---------------|--------------------|-------|
| 19 | Hendrick's Another Gin 41,4% 700ml | 1,29 € | identical | 129 ¢ = 1,29 € | ✅ |
| 1 | L'Oratoire des Papes Chateauneuf Du Pape Rouge 15% 0.75 l | 32,90 € | identical | 3290 ¢ = 32,90 € | ✅ |
| 3550 | Crystal Head Vodka 40,0% 1,75L | 99,96 € | identical | 9996 ¢ = 99,96 € | ✅ |

Live catalog sanity: `/api/v1/products?sort=ALPHABETICAL&page=1&limit=5` returns
`total: 22804`, `savingsAsOf: 2026-11-02` (current date — not stale).

**No staleness detected 3–8 min post-deploy: rendered names/prices match the live API exactly.**

## 2. Production ISR cache evidence (`/tietoja`, two spaced requests) — **PASS**

Request 1 (08:49 UTC):
```
HTTP/2 200
cache-control: s-maxage=2, stale-while-revalidate=2592000
x-nextjs-cache: STALE
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
```
Request 2, +15 s:
```
HTTP/2 200
cache-control: s-maxage=45, stale-while-revalidate=2592000
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
```

Interpretation: req 1 landed just past `s-maxage` and served STALE while
background revalidation ran; 15 s later the same URL serves **HIT** — the ISR
incremental cache is warm and persisting on the new deployment (matches what
the 4.1 fix targeted; not the every-request-miss behavior of the regression).

## 3. R2 incremental-cache write evidence (direct object listing) — **NOT PRACTICAL**

Attempted, honestly negative:
- Host credential (`/root/.cloudflare-token`, used inline, never printed) with
  Cloudflare REST `GET /accounts/{id}/r2/buckets/rajahinta-frontend-cache-production/objects`
  (tried with and without `?jurisdiction=eu`): returns `10006 "bucket does not exist"`.
- `GET /accounts/{id}/r2/buckets` with the same token lists only **6 buckets,
  none `rajahinta-*`** — the token is bucket-scoped to unrelated projects, so it
  cannot see (and cannot enumerate) the production cache bucket.
- Worker scripts ARE visible in this account, including
  `rajahinta-frontend-production` — the gap is R2-scope-specific, not
  account-specific. Production deploys authenticate with the
  `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` **GitHub secrets**
  (`.github/workflows/deploy-production.yml`), which were not used here.

**Consequence:** no direct object listing of fresh incremental-cache writes today.
Indirect evidence remains strong: `x-nextjs-cache: HIT` on the second `/tietoja`
request (§2) is only servable if the ISR cache store behind the worker already
holds the entry, and the correct `s-maxage` countdown implies store reads are live.
A bucket-scope-exempt token (or `wrangler r2 object` via CI secrets) can confirm
writes directly later — deliberately not forced this session.

## 4. First CPU datapoint (frontend Worker) — **EARLY DATAPOINT ONLY, NOT A TREND**

Cloudflare GraphQL (host token had the right scope; the quantile dataset is now
`workersInvocationsAdaptive` — `workerInvocationsAdaptiveQuantile` no longer
exists in the schema):
`workersInvocationsAdaptive(filter: {datetime_geq: "2026-11-02T08:40:00Z",
scriptName: "rajahinta-frontend-production"})`. Quantiles are in **microseconds**.

| Minute (UTC) | Status | Requests | cpu P50 (ms) | cpu P99 (ms) |
|---|---|---|---|---|
| 08:40 (pre-deploy) | success | 3 | 318.7 | 376.1 |
| 08:42 (pre-deploy) | success | 3 | 126.3 | 327.5 |
| 08:45 (deploy minute) | success | 9 | 51.3 | 271.5 |
| 08:46 | success | 8 | 137.9 | 379.0 |
| 08:48 | success | 10 | 395.1 | 1008.8 |
| 08:49 | success | 2 | 16.3 | 57.5 |
| 08:50 | success | 2 | 156.5 | 291.7 |

Caveats, stated plainly: n ≈ 31 post-deploy requests, mostly verification curls
(the 08:48 P50 of 395 ms coincides with the 221 KB SSR render of `/tuotteet` and
`/tietoja` fetches; the 08:49 P50 of 16 ms is mostly static-asset serving).
Per-minute P50 on such volume is noise. **No conclusion is drawn from this
datapoint; it anchors t₀ for the 24–48 h comparison below.**

---

## PENDING (24–48 h) — explicitly NOT measured yet

The following require the 24–48 h post-deploy window and MUST be re-run; no
trend is claimed today:

- **Frontend ms/req blended trend toward ≤ 40 ms.** Baselines on record:
  Oct 23 (healthy) ≈ **39 ms/req**; Oct 26+ (regressed window) ≈ **130–175 ms/req**;
  regressed window totals **35.39M ms / 394K req** (~90 ms/req blended).
  Source: the Workers analytics window cited in the change proposal.
- **API Worker request-volume comparison** vs the Oct 26+ window (volume should
  FALL if the Oct 26+ inflation is confirmed as frontend-origin duplicate load).
  Not measured today.
- **Direct R2 incremental-cache write listing** (§3) with a token that has
  R2 read on `rajahinta-frontend-cache-production` (jurisdiction `eu`).
- Optional: repeat the §1 spot-check after an ISR revalidate window (>300 s)
  and again at +24 h to confirm freshness over time.

Re-run pointers: CPU/volume via GraphQL `workersInvocationsAdaptive` (see §4
query shape) and `workersInvocationsByOwnerAndScriptGroups`; headers via two
spaced `curl -sD - https://rajahinta.fi/tietoja`; staleness via the §1 table.

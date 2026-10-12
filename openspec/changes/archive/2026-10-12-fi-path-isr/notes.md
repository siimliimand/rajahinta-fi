# Task 4.2 notes: staging deploy and FI-path ISR verification

Date: 2026-10-12. Branch: `feature/fi-path-isr`, head `d1b99a2` (tasks up to 4.1). Authoritative run: https://github.com/siimliimand/rajahinta-fi/actions/runs/38235431894 (workflow_dispatch on the branch ref, success, health gate 200, deployed 10:21 UTC). Same host and vantage as the previous verifications: Cloudflare colo ORD (NA), EU-jurisdiction R2 bucket behind it.

Deploy needed three dispatches. Run 38234154015 failed in the frontend wrangler deploy (`Received a malformed response from the API`); run 38234807886 failed in the API worker deploy (`PUT /accounts/.../workers/scripts/rajahinta-api-staging/schedules -> 504 Gateway Timeout`, HTML error page). Both are Cloudflare API-side errors in different steps; the branch content was not implicated (the same pipeline deployed twice earlier today). Staging stayed healthy between attempts (`/api/v1/health/ready` 200). Third dispatch green.

Verdict: PASS on the change's core goal. The FI path `/tuotteet/{id}` is now a real ISR route: the cold visit renders once with the exact target header `cache-control: s-maxage=300, stale-while-revalidate=31535700` and `x-nextjs-cache: MISS`, and every subsequent request measured was cache-served (`x-nextjs-cache: HIT` or `STALE`) at 0.30 to 1.05 s instead of a 2.7 to 3.2 s re-render. The warm class matches the EN HIT measured in the previous verification (0.75 s) from this vantage.

## FI path measurements (A=7872, B=1610, plus a fresh key C=3414)

Cold/warm TTFB, seconds (`curl -so /dev/null -w '%{time_starttransfer}'`):

- A-cold 3.142, A-warm 0.849
- B-cold 3.192, B-warm 0.807
- C=3414 (never requested this deployment, clean second-request test): cold 2.726, warm 0.894

Header shapes:

- Cold MISS responses carry the change's exact pinned contract: `cache-control: s-maxage=300, stale-while-revalidate=31535700`, `x-nextjs-cache: MISS`, `x-nextjs-stale-time: 300` (observed on A-cold, B-cold, C-cold).
- Warm responses are cache serves with `x-nextjs-cache: HIT` or `STALE`. When the adapter emits cache-control on a warm serve it is the rewritten remaining-window shape, for example `s-maxage=230, stale-while-revalidate=2592000` on a request about 70 s after fill (the OpenNext rewrite documented in the previous change's notes); some STALE serves carry no cache-control line. The pinned 300-string appears on the MISS render; the worker rewrites it on subsequent serves.
- MISS then HIT on the literal second request held cleanly for A (HIT) and C (HIT). B went MISS then STALE (still a cached serve, not a re-render), and later repeats oscillated HIT/STALE across both products. Every STALE still serves the cached shell while refreshing in the background; no warm request re-rendered. The oscillation looks like an entry-timestamp or per-isolate quirk in the adapter's cache layer; not bisected per task instruction.

## EN regression check

`/en/products/7872`: MISS (render, 2.187 s, `s-maxage=60, stale-while-revalidate=31535940` tree-min shape) then HIT 0.487 s. Unchanged behavior; no regression.

## Listing check

`/tuotteet` (no id): HTTP 200, 2.049 s, `lang="fi"`, product content present, still `private, no-cache, no-store` (per-request dynamic is this page's contract via searchParams). Middleware locale negotiation works for everything except the excluded `/tuotteet/<id>` tree, as designed; no 404, no redirect loop.

## HTML spot checks on `/tuotteet/7872`

- `lang="fi"` on the html element: present. PASS.
- Age-gate overlay: `data-age-gate-overlay`, `id="age-gate-body"`, `id="age-gate-title"` present. PASS.
- Pre-paint script: inline first script reads the `age_confirmed` cookie and sets `data-age-confirmed` on `<html>` before paint. Present. PASS.
- Canonical: `<link rel="canonical" href="/tuotteet/7872"/>` is present but RELATIVE, not `https://rajahinta.fi/tuotteet/7872`. Deviation from the stated expectation. The layout sets `metadataBase` from `SITE_URL` (default `https://rajahinta.fi`), and the ld+json block in the same HTML carries the absolute `https://rajahinta.fi` URL, so the absolute form may still surface in production builds; on this staging deploy the emitted tag is relative. Recorded, not fixed (outside this task's scope).
- hreflang: `<link rel="alternate" hrefLang="fi" href="/tuotteet/7872"/>`, `hrefLang="en"` to `/en/products/7872`, plus `x-default`. Present. PASS (hrefs are relative, same caveat as the canonical).

## Locale normalization check

`/fi/tuotteet/7872` returns 307 to `/tuotteet/7872` with `set-cookie: NEXT_LOCALE=fi`, same as before the change. Untouched. PASS.

## Deviations and notes

1. B-warm showed `STALE` instead of `HIT` on the literal second request; HIT/STALE oscillated on later repeats for both products. All such responses were cached serves (0.30 to 1.05 s). The success criterion is met on fresh keys (A and C clean MISS-to-HIT) and in substance for B (cached serve, no re-render).
2. Warm-serve cache-control is the adapter's remaining-window rewrite, not the pinned 300-string; the pinned string is what the MISS render emits.
3. Canonical (and hreflang) hrefs are relative on staging; expected absolute `https://rajahinta.fi` form. Flagged for the lead to check against the production build.
4. Two failed deploy runs before the green one, both Cloudflare API errors, detailed above.

Blockers: none. The change's goal (FI cold visit within the window is a cache HIT, not a re-render) is demonstrated on staging.

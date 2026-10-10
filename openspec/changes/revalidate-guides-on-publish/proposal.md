# Proposal: revalidate-guides-on-publish

## Why

Published content does not appear on the site when it is published. Two
cache layers sit between the ops-console publish transition and the visitor:

1. The frontend data cache holds the guides/blog server fetches for
   **900 s** (`next: { revalidate: 900 }` in `guides.server.ts` /
   `blog.server.ts`) — a published post waits up to 15 minutes to enter the
   index, and an unpublished/empty index serves stale for the same window.
2. The CDN layer adds `s-maxage=29, stale-while-revalidate=2592000` on top.

Observed 2026-10-10: immediately after publishing the advance-notice guide,
`/oppaat` served a stale pre-publication 404 for one request, and the 900 s
data-cache window would have delayed the listing for up to 15 minutes for
other visitors. Publish happens on the API worker; the cache lives on the
frontend worker — no current path crosses between them.

## What Changes

- **Tag the fetches at the true staleness source:** guides server fetches
  get `tags: ['guides']`, blog server fetches `tags: ['blog']` (data-cache
  tags; the 900 s fallback cadence is unchanged).
- **Internal revalidate endpoint on the frontend worker:**
  `POST /api/internal/revalidate` — POST-only, shared-secret gated
  (`x-revalidate-token`), tag allowlist (`guides`, `blog`), calls
  `revalidateTag` per tag. Constant-time token comparison; no body
  reflection.
- **API worker publish transition calls it:** after a successful blog-post
  publish, a `waitUntil` POST to the frontend endpoint with the shared
  secret. **Fail-open by design** — a missed revalidation costs ≤15 minutes
  of staleness, never a failed publish. Unset secret → skipped cleanly.
  The outcome is audited (`cache_revalidate` on the blog post).
- **Secrets wiring:** `REVALIDATE_TOKEN` (frontend worker) +
  `FRONTEND_REVALIDATE_TOKEN` (API worker), same generated value, set per
  environment via `wrangler secret put` before the code deploys.

## Risks

- New public endpoint — mitigated: POST-only (GET 405), secret-gated,
  allowlisted tags, no state change beyond cache invalidation.
- Outbound call adds latency to publish — mitigated: `waitUntil`, off the
  response path entirely.

## Capabilities

- Amended: `content-publication` (publish triggers cache revalidation),
  `web-application` (internal revalidate endpoint).

## Out of Scope

- Other `revalidate: 900` surfaces (savings, allowances, lists, homepage
  FAQ) — none of them change on an operator publish today.
- Unpublish/re-publish flows — PUBLISHED is terminal; no such transition
  exists.

## Sequencing Notes

Small, single-thread change implemented directly. Secrets must exist in
staging/production before the code that calls them deploys — ordering is
enforced in the finish run (fail-open makes a missed ordering harmless:
the call 401s/503s and the audit row says so).

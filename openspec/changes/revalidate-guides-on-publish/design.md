# Design: revalidate-guides-on-publish

## Context

Publish (API worker) and cache (frontend worker) are different Workers with
no connecting path. The frontend caches guide/blog API fetches for 900 s in
the OpenNext incremental cache (R2 + memory revalidation queue — on-demand
`revalidateTag` is supported by this setup). The fix must cross the worker
boundary without adding latency or a failure mode to publish.

## Goals

- A published post is visible on the guides/blog surfaces on the first
  request after publish, not up to 15 minutes later.
- Publish keeps its latency, its success semantics, and its audit trail
  regardless of revalidation outcome.

## Non-goals

- No change to the 900 s fallback cadence (it stays as the safety net).
- No CDN-level purge automation (the s-maxage=29 window is negligible).
- No revalidation for non-publish surfaces.

## Decisions

### D1: Data-cache tags, not path revalidation
The staleness lives in fetch-level data-cache entries, so the fetches get
tags: `guides` (index + slug, both locales via `guides.server.ts`) and
`blog` (index + slug via `blog.server.ts`). `revalidateTag('guides')`
invalidates every cached guide fetch at once — simpler and more complete
than per-path bookkeeping across the `[locale]` segment.

### D2: Endpoint shape
`POST /api/internal/revalidate` on the frontend worker (outside `[locale]`):
- auth: `x-revalidate-token` header vs the `REVALIDATE_TOKEN` worker
  secret, compared constant-time; unset secret → 503 (feature off, not an
  auth bypass);
- body `{ tags: string[] }` filtered against the allowlist
  (`guides`, `blog`); empty intersection → 400;
- `dynamic = 'force-dynamic'`; GET → 405 by framework; responses never
  echo the token or request body beyond the allowlisted tag names.

### D3: API worker call — fail-open, audited, off-path
After the existing publish audit row, the transition issues
`c.executionCtx.waitUntil(...)` — publish latency unchanged. The helper:
- no `FRONTEND_REVALIDATE_TOKEN` configured → skip (audited);
- POST `${APP_PUBLIC_URL}/api/internal/revalidate` with the shared token
  and `{ tags: ['guides', 'blog'] }`, 5 s timeout;
- every outcome (http status / skip / error) appended to the audit trail
  on the published post. The audit action vocabulary is pinned by the
  `audit_events_action_check` D1 constraint, so the row uses the existing
  `updated` action with a structured `cacheRevalidate` outcome in
  `newValue` — no vocabulary migration for an ancillary outcome; audit
  failures are swallowed (a waitUntil must never throw).

### D4: Secret wiring
One generated value, two names: `REVALIDATE_TOKEN` (frontend worker) and
`FRONTEND_REVALIDATE_TOKEN` (API worker), set per environment with
`wrangler secret put` (staging + production) before the calling code
deploys. Locally: `.dev.vars`. Unset anywhere → the flow degrades to
today's behavior (skip + audit), so the rollout is safe in any order.

### D5: Scope
Only the two surfaces an operator publish actually changes (guides, blog).
The 900 s cadence remains the safety net that bounds any missed call.

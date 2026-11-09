# Proposal

## Why

The frontend's intended 900-second server-fetch cache is ineffective because `apiFetch` generates a fresh `x-request-id` before Next computes the fetch cache key. Next excludes `traceparent` and `tracestate` from that key, but includes `x-request-id`. Every call therefore misses the previous entry and writes another R2 object.

This is sustained cache-key explosion, not a November 7 deployment regression. The current production build contained 213,769 cache objects on November 9, of which 152,987 were `.fetch` entries. A stratified sample of 454 `.fetch` entries contained only 11 distinct URLs. The shared footer fetches the blog and guides indexes on every localized render, multiplying the defect across the site.

## What Changes

- Keep generated `traceparent` on outbound API requests, but omit generated `x-request-id` for requests with a positive `next.revalidate` value so their Next cache keys remain stable.
- Preserve explicit caller-supplied request IDs, existing non-cacheable request behavior, and the separate `serverRequest()` service-binding path.
- Let the API Worker generate and echo a UUID when an origin request arrives without `x-request-id`, preserving structured request logging and response correlation.
- Add regression coverage using Next's real `generateCacheKey` implementation and verify on staging that repeated footer reads no longer create per-render `.fetch` objects.
- Add a 30-day object-expiration lifecycle rule to the staging and production frontend R2 cache buckets. Do not perform a bulk cache deletion.
- Update the OpenNext runbook and stale inline cache comments to describe the stable-key invariant and lifecycle operation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-application`: server-side cached fetches must retain stable cache identity across regenerated trace context, and deployed frontend cache buckets must expire old objects.
- `deployment-observability`: cache-compatible request correlation must preserve trace propagation, API-generated request IDs, explicit caller IDs, and existing non-cacheable behavior.

## Non-goals

- Migrating `memoryQueue` to `doQueue`.
- Changing ISR windows, route behavior, footer visibility rules, or publication behavior.
- Disabling the Next data cache or moving all server reads to uncached requests.
- Bulk-deleting current or historical cache objects.
- Changing observation logs, rate snapshots, D1 data, or API contracts.

## Impact

Affected code is concentrated in `apps/frontend/src/lib/api.ts` and its tests. Verification covers the shared blog/guides fetch helpers, Next cache-key generation, frontend Worker behavior, API Worker request logging, and R2 object growth. Operational changes affect only `rajahinta-frontend-cache-staging` and `rajahinta-frontend-cache-production`. No dependency or database migration is required.

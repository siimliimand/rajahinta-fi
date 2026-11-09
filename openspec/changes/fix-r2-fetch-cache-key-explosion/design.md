# Design

## Context

`apiFetch` currently adds both a fresh `traceparent` and a fresh UUID `x-request-id` before calling Next's patched `fetch`. Next's `generateCacheKey` removes `traceparent` and `tracestate` from the key but retains `x-request-id`. This defeats both per-render deduplication and the persistent data cache.

The shared `SiteFooter` calls `getServerBlogIndex` and `getServerGuidesIndex` for each locale. Those helpers use the affected request path with `next: { revalidate: 900 }`. R2 inspection confirmed that repeated objects for these four locale-specific URLs dominate the sampled `.fetch` entries.

The API Worker already generates a UUID when `x-request-id` is absent, echoes it, and writes it to structured logs. The `API_WORKER` service-binding path is separate and does not participate in Next's fetch cache.

## Goals / Non-Goals

**Goals:**

- Restore stable Next fetch-cache identity without changing public response behavior.
- Preserve distributed tracing and request-ID logging on actual origin calls.
- Bound frontend cache retention without touching durable data.
- Verify the fix with real cache-key semantics and deployed R2 evidence.

**Non-Goals:**

- Replacing the revalidation queue or changing ISR policy.
- Reducing cache volume by disabling caching.
- Changing API response contracts or footer publication rules.
- Performing a one-time bucket purge or a recurring full-bucket census.

## Decisions

### D1: Centralize cache-aware tracing in `apiFetch`

For an init with a numeric `next.revalidate > 0`, `apiFetch` will keep generated `traceparent` but omit generated `x-request-id`. This is the earliest shared point before Next computes the cache key, and it covers all affected call sites without individual rewrites.

Explicit caller-supplied IDs remain unchanged. Requests without a positive revalidation window retain the current generated UUID behavior. A global removal of request IDs was rejected because it would weaken non-cacheable request correlation and alter explicit caller behavior.

### D2: Let the API Worker assign missing request IDs

On an actual cache miss, the API Worker generates and echoes the request ID using its existing middleware. `traceparent` still provides distributed trace correlation, while the API-generated UUID identifies the origin request in logs and error responses.

Deterministic frontend request IDs were rejected because they would correlate unrelated origin requests under one identifier. Removing tracing from cached reads was rejected because cache hits and misses would then have inconsistent observability.

### D3: Leave service-binding and publication behavior unchanged

`serverRequest()` continues to add its current trace and request-ID headers. It bypasses Next's fetch cache, so cache-key fragmentation does not apply there. Footer visibility, blog/guides publication, tag revalidation, and ISR windows remain unchanged.

Switching dynamic catalog reads to uncached requests was considered but excluded from this change. It would trade R2 savings for additional API load without fixing the shared cache-key defect.

### D4: Use lifecycle expiry instead of bulk deletion

Apply a 30-day expiration rule to the staging and production frontend cache buckets. Existing build-scoped and duplicate objects age out without an operator deleting live cache namespaces. Cold misses after expiry are normal cache behavior and regenerate from source data.

The Durable Object queue migration is deferred. It addresses duplicate route revalidation, not the `.fetch` key explosion measured here.

### D5: Verify cache semantics directly

Unit tests cover header selection and caller overrides. A second regression passes captured request inits through Next's real `generateCacheKey`, proving that regenerated trace context no longer changes the key.

Staging verification uses bounded R2 samples grouped by payload `data.url`. It checks that repeated renders stop creating duplicate blog/guide entries and that origin logs retain request IDs and trace context. Routine verification must avoid full-bucket scans because `ListObjects` is itself a Class A operation.

## Risks / Trade-offs

- [Cacheable-request detection is too broad or narrow] -> Focused tests pin positive-revalidation behavior, non-cacheable behavior, and explicit IDs before deployment.
- [A caller supplies its own fresh request ID and still fragments the cache] -> Explicit IDs retain framework semantics by design; current production call sites were audited and do not supply per-request IDs to these cached reads.
- [Cache hits appear to lose API log correlation] -> Verification distinguishes cache hits, which have no origin request, from misses, which must carry API-generated request IDs and trace context.
- [Lifecycle expiry removes useful cold entries] -> Entries are regenerable cache data only; observation logs, rate snapshots, and durable records are excluded.
- [R2 inspection adds billable operations] -> Deployed checks use bounded samples rather than another full-bucket census.

## Migration Plan

1. Land the cache-aware header change, regression tests, and documentation; run the full frontend verification set and OpenNext build.
2. Apply the lifecycle rule to staging and deploy through the normal staging pipeline.
3. Run the staging cache matrix and record bounded R2, API logging, footer, and revalidation evidence.
4. Apply the production lifecycle rule and run the gated production deploy only after staging is green.
5. Record immediate and 24-hour R2 write, API volume, and content-freshness results.

Rollback uses the existing frontend Worker rollback process. No database rollback is needed. The lifecycle rule may remain during rollback because it only expires regenerable cache objects.

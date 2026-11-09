import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * OpenNext → Cloudflare adapter config (migrate-to-cloudflare task 5.1).
 *
 * Cache choices, matched to the app's actual feature usage:
 *
 * - ISR and tagged data-cache fetches are in use. Verified windows
 *   (Next 16.4.3): `[locale]/layout.tsx` (`revalidate = 60`), product
 *   detail (`revalidate = 300` on `[locale]/products/[id]` and the FI
 *   root `/tuotteet/[id]`, plus their OG images), `sitemap.xml/route.ts`
 *   and `sitemaps/[tree]/route.ts` (`revalidate = 900`; the old
 *   `sitemap.ts` metadata route is gone), and `next: { revalidate: 900 }`
 *   data-cache fetches (blog/guides server modules,
 *   `src/lib/server-api.ts`, `src/lib/sitemap-entries.ts`). Time-based
 *   revalidation therefore needs both an incremental cache AND a
 *   revalidation queue (adapter caching docs: "A queue must be setup for
 *   projects using Time-Based revalidation").
 *
 * - Stable cache-key invariant (fix-r2-fetch-cache-key-explosion): Next's
 *   `generateCacheKey` strips `traceparent`/`tracestate` and keeps every
 *   other header, including `x-request-id`. `apiFetch` therefore omits
 *   the generated `x-request-id` on positive-revalidate reads (the
 *   generated `traceparent` stays); a per-render UUID would otherwise
 *   mint a distinct cache key, and a distinct R2 `.fetch` object, per
 *   render. The API Worker assigns a UUID on an actual miss. The
 *   `API_WORKER` binding path bypasses Next's fetch cache and is
 *   unaffected.
 *
 * - Incremental cache: R2 (`NEXT_INC_CACHE_R2_BUCKET` binding, see
 *   wrangler.jsonc). KV is explicitly discouraged by the adapter docs
 *   (eventual consistency); the static-assets cache is read-only and does
 *   not support revalidation. The staging and production buckets are
 *   managed with a 30-day object-expiration lifecycle rule (OPENNEXT.md);
 *   no bulk deletion is performed.
 *
 * - Queue: memory queue — deliberate deviation from the adapter's
 *   "small site using revalidation" default (`doQueue`). Cloudflare does
 *   not generate preview URLs for Workers that IMPLEMENT a Durable Object
 *   (developers.cloudflare.com/workers/versions-and-deployments/
 *   preview-urls/#limitations), and the generated worker exports
 *   `DOQueueHandler` — per-PR preview URLs are a hard requirement of this
 *   migration (task 5.1 / wired by 6.5), so the DO queue is disqualified.
 *   The memory queue revalidates directly with per-isolate dedupe
 *   (requires the WORKER_SELF_REFERENCE service binding); the adapter docs
 *   bless it for low-traffic staging and accept it for small production
 *   sites. At this app's scale (layout ISR at 60 s, product pages at
 *   300 s, sitemap and data-cache fetches at 900 s) the worst case is a
 *   few duplicate revalidations per window across isolates; correctness
 *   is unaffected. Revisit at production scale: swap to `doQueue` here,
 *   add the `NEXT_CACHE_DO_QUEUE` binding + `new_sqlite_classes` migration
 *   in wrangler.jsonc, and accept losing preview URLs (or gate previews to
 *   a queue-less preview build).
 *
 * - Tag cache: the app DOES call `revalidateTag`.
 *   `src/app/api/internal/revalidate/route.ts` calls
 *   `revalidateTag(tag, 'max')` for `guides` and `blog` (Next 16 requires
 *   a cache profile; `'max'` marks every entry for the tag stale). The
 *   API Worker's publish transition invokes that endpoint after a
 *   successful blog-post publish. No tag cache is configured here and
 *   `wrangler.jsonc` declares no `NEXT_TAG_CACHE_*` binding, so the
 *   adapter's dummy tag cache is active (`writeTags` no-op, `getByTag`
 *   returns `[]`). On-demand tag revalidation has no persistent store on
 *   the deployed Worker today; time-based ISR is the effective freshness
 *   mechanism. To wire a store, add `d1NextTagCache` (or
 *   `doShardedTagCache` at higher load) here and the matching
 *   `NEXT_TAG_CACHE_*` binding in wrangler.jsonc.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});

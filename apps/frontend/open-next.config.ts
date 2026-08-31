import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * OpenNext → Cloudflare adapter config (migrate-to-cloudflare task 5.1).
 *
 * Cache choices, matched to the app's actual feature usage:
 *
 * - ISR is used (time-based revalidation only): `[locale]/layout.tsx`
 *   (`revalidate = 60`), `sitemap.ts` (`revalidate = 900`) and the API
 *   data-cache fetches in `src/lib/api.ts` (`revalidate: 60 | 900`).
 *   Time-based revalidation therefore needs both an incremental cache AND
 *   a revalidation queue (adapter caching docs: "A queue must be setup for
 *   projects using Time-Based revalidation").
 *
 * - Incremental cache: R2 (`NEXT_INC_CACHE_R2_BUCKET` binding, see
 *   wrangler.jsonc). KV is explicitly discouraged by the adapter docs
 *   (eventual consistency); the static-assets cache is read-only and does
 *   not support revalidation.
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
 *   sites. At this app's scale (one small ISR layout at 60 s, sitemap at
 *   900 s) the worst case is a few duplicate revalidations per window
 *   across isolates; correctness is unaffected. Revisit at production
 *   scale: swap to `doQueue` here, add the `NEXT_CACHE_DO_QUEUE` binding +
 *   `new_sqlite_classes` migration in wrangler.jsonc, and accept losing
 *   preview URLs (or gate previews to a queue-less preview build).
 *
 * - No tag cache: the app never calls `revalidateTag`/`revalidatePath`
 *   (verified across `src/`), so on-demand revalidation components are
 *   intentionally omitted. If on-demand revalidation is ever introduced,
 *   add `d1NextTagCache` (or `doShardedTagCache` at higher load) here and
 *   the matching `NEXT_TAG_CACHE_*` binding in wrangler.jsonc.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});

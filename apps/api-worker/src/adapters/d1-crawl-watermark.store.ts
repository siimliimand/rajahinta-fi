/**
 * D1-backed crawl watermark + cursor store — the Worker-side durable
 * backing for the sitemap crawl cycle (task 3.1, change
 * sitemap-crawl-merchants; design D5). Implements both ports the cycle
 * consumes: `ILastmodWatermarkStore` (the completed cycle's per-merchant
 * `loc → lastmod` map) and `ICrawlCursorStore` (the in-flight cycle's
 * pending URL queue + chunk offset).
 *
 * Rows live in the generic `aggregation_watermarks (job_name UNIQUE,
 * watermark TEXT, updated_at)` table — the repository-parity raw-SQL
 * pattern of the time-series backfill cursor and the savings-snapshot
 * cursor (no schema change, no dedicated table). One namespace per
 * artifact per merchant:
 *
 * - `sitemap-crawl-lastmod-<merchantId>` — the last completed cycle's
 *   lastmod map, JSON `Record<loc, lastmod | null>`;
 * - `sitemap-crawl-cursor-<merchantId>` — the in-flight cycle, JSON
 *   `{ queue: string[], offset: number }`; an absent row is "no cycle
 *   in flight".
 *
 * Watermark isolation (the project rule behind the '9194'/'0'
 * shadowing incidents): every read is `WHERE job_name = ?` on THIS
 * job's row — never a table-wide aggregate; the row's semantics are
 * crawl-JSON and nothing else reads it. Values are SHAPE-CHECKED
 * before use (the display-boundary discipline applied to crawl state):
 * an unusable persisted value reads as absent — full re-crawl for the
 * watermark, fresh discovery for the cursor — never as a partially
 * decoded state.
 *
 * Row size: the JSON carries at most the sitemap's product-URL set
 * (today's largest configured source, full-refresh drinkonline, is
 * 1,838 URLs ≈ ~130 KB per row) — well inside the D1 row/string limit.
 * A source with a two-orders-of-magnitude larger sitemap would near
 * that limit; that bound is a per-source registry decision, not
 * something this store can police.
 *
 * @module D1CrawlWatermarkStore
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { SitemapWatermark } from '../../../../packages/data-acquisition/src/crawl/lastmod-diff';
import type { ILastmodWatermarkStore } from '../../../../packages/data-acquisition/src/crawl/lastmod-watermark.port';
import type {
  CrawlCursorState,
  ICrawlCursorStore,
} from '../../../../packages/data-acquisition/src/crawl/crawl-chunk-cycle';

/** Row namespace of the per-merchant lastmod map. */
export const CRAWL_LASTMOD_JOB_PREFIX = 'sitemap-crawl-lastmod-';

/** Row namespace of the per-merchant in-flight crawl cursor. */
export const CRAWL_CURSOR_JOB_PREFIX = 'sitemap-crawl-cursor-';

export function crawlLastmodJobName(merchantId: string): string {
  return `${CRAWL_LASTMOD_JOB_PREFIX}${merchantId}`;
}

export function crawlCursorJobName(merchantId: string): string {
  return `${CRAWL_CURSOR_JOB_PREFIX}${merchantId}`;
}

/**
 * Shape-check a decoded lastmod row: a JSON object whose every value is
 * a string or null (the `SitemapWatermark` contract). Anything else —
 * garbage, an array, a number row from another job's semantics — reads
 * as absent (full re-crawl, the safe direction).
 */
function isWatermarkShape(value: unknown): value is Record<string, string | null> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || entry === null,
  );
}

/**
 * Shape-check a decoded cursor row: `{ queue: string[], offset }` with
 * a safe non-negative integer offset within the queue's bounds.
 */
function isCursorShape(
  value: unknown,
): value is { queue: string[]; offset: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { queue, offset } = value as { queue?: unknown; offset?: unknown };
  return (
    Array.isArray(queue) &&
    queue.every((url) => typeof url === 'string' && url.length > 0) &&
    typeof offset === 'number' &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset <= queue.length
  );
}

/** Read one job's TEXT row, JSON-decoded and shape-checked, or null. */
async function readJobJson(
  d1: D1DatabaseLike,
  jobName: string,
): Promise<unknown> {
  const row = await d1
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .bind(jobName)
    .first<{ watermark: string }>();
  if (row === null || typeof row.watermark !== 'string') {
    return null;
  }
  try {
    return JSON.parse(row.watermark) as unknown;
  } catch {
    return null;
  }
}

/** Upsert one job's TEXT row on the job_name UNIQUE key. */
async function writeJobJson(
  d1: D1DatabaseLike,
  jobName: string,
  value: unknown,
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (job_name) DO UPDATE SET
         watermark = excluded.watermark,
         updated_at = excluded.updated_at`,
    )
    .bind(jobName, JSON.stringify(value), new Date().toISOString())
    .run();
}

/**
 * One instance serves every crawl merchant (rows are merchant-keyed);
 * the ingestion compositions share it across the four adapters.
 */
export class D1CrawlWatermarkStore implements ILastmodWatermarkStore, ICrawlCursorStore {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc ILastmodWatermarkStore */
  async load(merchantId: string): Promise<SitemapWatermark | null> {
    const decoded = await readJobJson(this.d1, crawlLastmodJobName(merchantId));
    return isWatermarkShape(decoded) ? new Map(Object.entries(decoded)) : null;
  }

  /** @inheritdoc ILastmodWatermarkStore */
  async save(merchantId: string, watermark: SitemapWatermark): Promise<void> {
    await writeJobJson(
      this.d1,
      crawlLastmodJobName(merchantId),
      Object.fromEntries(watermark),
    );
  }

  /** @inheritdoc ICrawlCursorStore */
  async loadCursor(merchantId: string): Promise<CrawlCursorState | null> {
    const decoded = await readJobJson(this.d1, crawlCursorJobName(merchantId));
    if (!isCursorShape(decoded)) return null;
    return { queue: decoded.queue, offset: decoded.offset };
  }

  /** @inheritdoc ICrawlCursorStore */
  async saveCursor(merchantId: string, state: CrawlCursorState): Promise<void> {
    await writeJobJson(this.d1, crawlCursorJobName(merchantId), {
      queue: [...state.queue],
      offset: state.offset,
    });
  }

  /** @inheritdoc ICrawlCursorStore */
  async clearCursor(merchantId: string): Promise<void> {
    await this.d1
      .prepare('DELETE FROM aggregation_watermarks WHERE job_name = ?')
      .bind(crawlCursorJobName(merchantId))
      .run();
  }
}

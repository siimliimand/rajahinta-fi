/**
 * Chunked, resumable sitemap crawl cycle (task 3.1, change
 * sitemap-crawl-merchants; design D5).
 *
 * {@link runCrawlCycle} walks a whole diff in one call — right for a
 * self-contained adapter fetch, over every Workers budget when the diff
 * is a full first crawl (~10⁴ pages at the polite 1 req/s). This module
 * splits the same cycle into the three phases the ingestion Workflow
 * drives as durable steps:
 *
 * 1. `beginCrawlCycle` — sitemap once → product-URL filter → lastmod
 *    diff → persist the in-flight cursor (pending URL queue + offset 0)
 *    and the cycle's next watermark. A cursor from a previous
 *    incomplete cycle resumes instead: no sitemap fetch, no re-diff —
 *    the sitemap is fetched at most once per cycle (spec) and the
 *    already-crawled prefix is never repeated.
 * 2. `walkCrawlChunk` — walk at most {@link CRAWL_CHUNK_FETCHES} URLs
 *    from the cursor and report them; the queue itself is untouched.
 * 3. `advanceCrawlCursor` — durably move the offset past the reported
 *    chunk, clearing the cursor on the final chunk.
 *
 * The records commit before the advance: the Workflow hands a chunk's
 * records to its next step (`crawl-advance-N`) only after the chunk
 * step's output is durable, so a lost step output re-walks its slice
 * (bounded duplicate fetches, idempotent downstream upserts) while a
 * lost advance re-walks from the persisted offset — records are
 * re-fetched, never silently dropped. This is the aggregation pass's
 * write-then-advance shape with the workflow's own output cache as the
 * durable work record.
 *
 * Persistence order at begin is cursor FIRST, watermark second: a
 * cycle only walks once both rows are committed, and a watermark-write
 * failure aborts the cycle with the cursor removed — the next cycle
 * re-diffs against the previous watermark and re-crawls the full set.
 * Over-crawl is the safe direction; a watermark saved ahead of an
 * aborted cycle would under-crawl (unchanged URLs skipped although
 * never fetched).
 *
 * @module CrawlChunkCycle
 */

import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import {
  MIN_REQUEST_SPACING_MS,
  defaultSleep,
  walkProductPages,
  type PageFetcher,
  type PageProcessor,
  type Sleep,
} from './crawl-walker';
import type { SitemapWatermark } from './lastmod-diff';
import { diffSitemapEntries } from './lastmod-diff';
import type { ILastmodWatermarkStore } from './lastmod-watermark.port';
import type { ProductUrlPredicate } from './product-url-filter';
import { filterSitemapEntries } from './product-url-filter';
import { fetchSitemap } from './sitemap.fetch';

/**
 * The D5 chunk bound: ≤ 300 detail-page fetches per workflow step —
 * the chunk size proven by the time-series aggregation and savings
 * snapshot passes. At the polite 1 req/s a full chunk costs ~5 min
 * wall and ~310 subrequests (300 fetches + sitemap + D1 statements),
 * inside both the 15-min scheduled budget and the ~1,000-subrequest
 * per-invocation ceiling. Do not raise without re-measuring both.
 */
export const CRAWL_CHUNK_FETCHES = 300;

/**
 * The in-flight cycle's persisted position: the cycle's full crawl
 * queue (the diff result, sitemap order) plus how many URLs the
 * completed chunks already walked. Persistence is the store's problem
 * (task 3.1 wires `aggregation_watermarks` rows); the cycle only ever
 * reads it back through this port.
 */
export interface CrawlCursorState {
  readonly queue: readonly string[];
  readonly offset: number;
}

/**
 * Cursor storage port — the counterpart of
 * {@link ILastmodWatermarkStore} for the in-flight cycle state. A
 * failed load is the caller's problem (errors propagate so the
 * workflow step retries); a SHAPE-USABLE load contract is the store's:
 * an unusable persisted value must read as `null` (no cycle in
 * flight), never as a partially decoded cursor.
 */
export interface ICrawlCursorStore {
  /** The merchant's in-flight cursor, or null when no cycle is in flight. */
  loadCursor(merchantId: string): Promise<CrawlCursorState | null>;

  /**
   * Persist the cursor. Called once at cycle begin (offset 0) and once
   * per completed chunk — a failed save is a collected cycle error in
   * the advance step, never a throw into the walk.
   */
  saveCursor(merchantId: string, state: CrawlCursorState): Promise<void>;

  /** End the in-flight cycle (final chunk, or an aborted begin). */
  clearCursor(merchantId: string): Promise<void>;
}

/**
 * Process-lifetime cursor store — the default until the workflow wires
 * the durable `aggregation_watermarks` backing. Same safe-direction
 * behavior as `InMemoryLastmodWatermarkStore`: a fresh process reads as
 * "no cycle in flight" and re-discovers, never skipping pages.
 */
export class InMemoryCrawlCursorStore implements ICrawlCursorStore {
  private readonly cursors = new Map<string, CrawlCursorState>();

  async loadCursor(merchantId: string): Promise<CrawlCursorState | null> {
    return this.cursors.get(merchantId) ?? null;
  }

  async saveCursor(merchantId: string, state: CrawlCursorState): Promise<void> {
    this.cursors.set(merchantId, state);
  }

  async clearCursor(merchantId: string): Promise<void> {
    this.cursors.delete(merchantId);
  }
}

/** beginCrawlCycle outcome — the Workflow's `crawl-discover` step output. */
export interface CrawlDiscoverOutcome {
  /**
   * URLs of the cycle still to crawl (fresh begin: the whole diff
   * result; resume: the queue minus the walked prefix). 0 when nothing
   * changed or the cycle aborted. The chunk loop bounds its expected
   * step count from this.
   */
  readonly queueLength: number;
  /** True when an in-flight cursor was resumed (no sitemap fetched). */
  readonly resumed: boolean;
  /** Collected errors — non-empty means the cycle aborted untouched. */
  readonly errors: readonly string[];
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export interface BeginCrawlCycleOptions {
  readonly merchantId: string;
  /** The registry feedUrl — the merchant's product sitemap. */
  readonly sitemapUrl: string;
  readonly productUrlPredicate: ProductUrlPredicate;
  /** Full-refresh source (no sitemap `lastmod`): every cycle is full. */
  readonly fullRefresh: boolean;
  readonly watermarkStore: ILastmodWatermarkStore;
  readonly cursorStore: ICrawlCursorStore;
  readonly fetcher: PageFetcher;
}

/**
 * Begin (or resume) one cycle. Never throws for recoverable failures —
 * the `IFeedAdapter` must-not-throw contract; store failures inside the
 * discover step DO propagate (a transient D1 outage must retry, not
 * abort), while the collected-error outcomes above end the cycle with
 * nothing crawled and the persisted state untouched or removed.
 */
export async function beginCrawlCycle(
  options: BeginCrawlCycleOptions,
): Promise<CrawlDiscoverOutcome> {
  const label = options.merchantId;

  // Resume first: an in-flight cursor IS the cycle (its sitemap was
  // fetched when the cursor was written; the walked prefix is durable).
  const existing = await options.cursorStore.loadCursor(options.merchantId);
  if (existing !== null) {
    const offset = Math.min(existing.offset, existing.queue.length);
    return { queueLength: existing.queue.length - offset, resumed: true, errors: [] };
  }

  const sitemap = await fetchSitemap(options.sitemapUrl, options.fetcher);
  if (sitemap.errors.length > 0) {
    return { queueLength: 0, resumed: false, errors: [...sitemap.errors] };
  }

  const productEntries = filterSitemapEntries(
    sitemap.entries,
    options.productUrlPredicate,
  );

  // Same discipline as runCrawlCycle: a load failure must not skip
  // pages, so it falls back to the full set AND surfaces as a collected
  // cycle error (the crawl still happens — aborting would hide it).
  let previous: SitemapWatermark | null;
  let watermarkError: string | null = null;
  try {
    previous = await options.watermarkStore.load(options.merchantId);
  } catch (err) {
    previous = null;
    watermarkError = `${label} watermark load failed (${errorOf(err)}) — crawling the full set`;
  }

  const { urlsToCrawl, nextWatermark } = diffSitemapEntries(
    previous ?? new Map<string, string | null>(),
    productEntries,
    { fullRefresh: options.fullRefresh },
  );

  if (urlsToCrawl.length === 0) {
    // Steady state: nothing to crawl, no cursor — but the watermark is
    // rewritten (same content) so a first-ever cycle with an unchanged
    // sitemap still establishes the comparison state.
    try {
      await options.watermarkStore.save(options.merchantId, nextWatermark);
    } catch (err) {
      return {
        queueLength: 0,
        resumed: false,
        errors: [`${label} watermark save failed: ${errorOf(err)}`],
      };
    }
    return {
      queueLength: 0,
      resumed: false,
      errors: watermarkError === null ? [] : [watermarkError],
    };
  }

  // Commit to the cycle BEFORE walking: cursor first (the watermark
  // write may still fail — see the module header for the ordering).
  try {
    await options.cursorStore.saveCursor(options.merchantId, {
      queue: urlsToCrawl,
      offset: 0,
    });
  } catch (err) {
    return {
      queueLength: 0,
      resumed: false,
      errors: [`${label} crawl cursor save failed: ${errorOf(err)} — cycle aborted`],
    };
  }

  try {
    await options.watermarkStore.save(options.merchantId, nextWatermark);
  } catch (err) {
    // Roll the cycle back: crawl nothing, leave no cursor, so the next
    // cycle re-diffs against the previous watermark (over-crawl, safe).
    try {
      await options.cursorStore.clearCursor(options.merchantId);
    } catch (clearErr) {
      return {
        queueLength: 0,
        resumed: false,
        errors: [
          `${label} watermark save failed: ${errorOf(err)}`,
          `${label} crawl cursor rollback failed: ${errorOf(clearErr)} — the next cycle resumes this queue instead`,
        ],
      };
    }
    return {
      queueLength: 0,
      resumed: false,
      errors: [`${label} watermark save failed: ${errorOf(err)} — cycle aborted`],
    };
  }

  return {
    queueLength: urlsToCrawl.length,
    resumed: false,
    errors: watermarkError === null ? [] : [watermarkError],
  };
}

/** walkCrawlChunk outcome — the Workflow's `crawl-chunk-N` step output. */
export interface CrawlChunkOutcome {
  readonly records: RawFeedRecord[];
  readonly errors: readonly string[];
  /** URLs the walk attempted (the advance moves the cursor by this). */
  readonly fetched: number;
  /** True when the queue has no URLs after this chunk. */
  readonly done: boolean;
}

export interface WalkCrawlChunkOptions {
  readonly merchantId: string;
  readonly cursorStore: ICrawlCursorStore;
  /** Extracts zero or one RawFeedRecord from a detail page. */
  readonly extractPage: PageProcessor;
  readonly fetcher: PageFetcher;
  readonly sleep?: Sleep;
  readonly minSpacingMs?: number;
}

/**
 * Walk the next ≤ {@link CRAWL_CHUNK_FETCHES} slice of the in-flight
 * queue. Page-level failures collect (the walker's discipline); a
 * vanished cursor is a collected done-with-error (the cycle ends, the
 * run reports it) — only store/transient failures throw so the step
 * retries.
 */
export async function walkCrawlChunk(
  options: WalkCrawlChunkOptions,
): Promise<CrawlChunkOutcome> {
  const label = options.merchantId;
  const cursor = await options.cursorStore.loadCursor(options.merchantId);
  if (cursor === null) {
    return {
      records: [],
      errors: [
        `${label} crawl cursor vanished mid-cycle — chunk skipped, cycle ended`,
      ],
      fetched: 0,
      done: true,
    };
  }

  const offset = Math.min(cursor.offset, cursor.queue.length);
  const slice = cursor.queue.slice(offset, offset + CRAWL_CHUNK_FETCHES);

  const walk = await walkProductPages({
    errorLabel: label,
    urls: slice,
    processPage: options.extractPage,
    fetcher: options.fetcher,
    sleep: options.sleep ?? defaultSleep,
    minSpacingMs: options.minSpacingMs ?? MIN_REQUEST_SPACING_MS,
  });

  return {
    records: walk.records,
    errors: walk.errors,
    fetched: slice.length,
    done: offset + slice.length >= cursor.queue.length,
  };
}

export interface AdvanceCrawlCursorOptions {
  readonly merchantId: string;
  readonly cursorStore: ICrawlCursorStore;
  /** URLs the completed chunk reported (its step output is durable). */
  readonly fetched: number;
  /** The chunk's done flag — the final advance clears the cursor. */
  readonly done: boolean;
}

/**
 * Durably move the cursor past the chunk whose records already committed
 * (the workflow's `crawl-advance-N` step; see the module header). The
 * watermark itself was persisted at begin — the final advance only ends
 * the cycle.
 */
export async function advanceCrawlCursor(
  options: AdvanceCrawlCursorOptions,
): Promise<void> {
  if (options.done) {
    await options.cursorStore.clearCursor(options.merchantId);
    return;
  }

  const cursor = await options.cursorStore.loadCursor(options.merchantId);
  if (cursor === null) {
    // The cycle ended underneath us (cursor cleared elsewhere); clearing
    // again is idempotent and the next cycle re-discovers.
    await options.cursorStore.clearCursor(options.merchantId);
    return;
  }

  const offset = Math.min(
    cursor.offset + Math.max(0, options.fetched),
    cursor.queue.length,
  );
  await options.cursorStore.saveCursor(options.merchantId, {
    queue: cursor.queue,
    offset,
  });
}

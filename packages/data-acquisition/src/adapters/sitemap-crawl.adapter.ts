/**
 * Shared sitemap-crawl feed adapter (task 2.1, change
 * sitemap-crawl-merchants; design D2).
 *
 * The four v1 crawl merchants (viinarannasta, viinikauppa, licorea,
 * drinkonline) are the identical composition — the shared cycle
 * (`runCrawlCycle`: sitemap once → product-URL filter → lastmod diff →
 * polite walk → watermark save) over the shared extractor
 * (`extractProductPage`) — so the wiring lives here once and each
 * adapter pins only what genuinely differs: merchantId, extractor
 * config, product-URL predicate, refresh mode. The thin-subclass shape
 * the WooCommerce walk established (`woo-store.adapter.ts`).
 *
 * The registry feedUrl IS the merchant's product sitemap (the
 * `CrawlCycleOptions` contract); the registry `feedFormat: 'xml'`
 * describes exactly that — there is no paginated API to negotiate.
 *
 * Watermark persistence: `ILastmodWatermarkStore` is injectable. The
 * default is the in-memory store — process-lifetime only, so until
 * task 3.1 wires the durable D1 store, every fresh process behaves as
 * a first crawl (full refresh), the safe direction.
 *
 * Failure discipline is the cycle's: `runCrawlCycle` never throws for
 * recoverable failures and returns records plus collected errors — the
 * `IFeedAdapter` must-not-throw contract verbatim.
 *
 * ## Chunked protocol (task 3.1, design D5)
 *
 * `fetch()` runs the whole cycle in one call — a full first crawl
 * exceeds every Workers budget, so the ingestion Workflow drives the
 * same cycle through {@link SitemapCrawlFeedAdapter.beginCrawlCycle} /
 * {@link SitemapCrawlFeedAdapter.crawlChunk} /
 * {@link SitemapCrawlFeedAdapter.advanceCrawl} instead, ≤ 300 fetches
 * per durable step, resumable via the injected `ICrawlCursorStore`
 * (default in-memory, safe-direction). The identity gate is the
 * adapter itself: the workflow composes `SitemapCrawlFeedAdapter`
 * instances in its crawl map, so presence — not a flag — selects the
 * chunked path.
 *
 * @module SitemapCrawlAdapter
 */

import { runCrawlCycle } from '../crawl/crawl-cycle';
import {
  advanceCrawlCursor,
  beginCrawlCycle,
  InMemoryCrawlCursorStore,
  walkCrawlChunk,
  type CrawlChunkOutcome,
  type CrawlDiscoverOutcome,
  type ICrawlCursorStore,
} from '../crawl/crawl-chunk-cycle';
import {
  defaultPageFetcher,
  type PageFetcher,
  type Sleep,
} from '../crawl/crawl-walker';
import type { SitemapWatermark } from '../crawl/lastmod-diff';
import type { ILastmodWatermarkStore } from '../crawl/lastmod-watermark.port';
import { extractProductPage } from '../crawl/extract/extract-page';
import type { ExtractorConfig } from '../crawl/extract/extractor-config';
import type { ProductUrlPredicate } from '../crawl/product-url-filter';
import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';

/**
 * Process-lifetime watermark store — the default until task 3.1 wires
 * the durable `aggregation_watermarks` backing. Keyed by merchantId so
 * one instance can serve several adapters, and tests can preload a
 * previous cycle's state.
 */
export class InMemoryLastmodWatermarkStore implements ILastmodWatermarkStore {
  private readonly watermarks = new Map<string, SitemapWatermark>();

  constructor(initial?: ReadonlyMap<string, SitemapWatermark>) {
    if (initial !== undefined) {
      for (const [merchantId, watermark] of initial) {
        this.watermarks.set(merchantId, watermark);
      }
    }
  }

  async load(merchantId: string): Promise<SitemapWatermark | null> {
    return this.watermarks.get(merchantId) ?? null;
  }

  async save(merchantId: string, watermark: SitemapWatermark): Promise<void> {
    this.watermarks.set(merchantId, watermark);
  }
}

/**
 * The per-source identity (the task 2.2 seed merchantIds, exact) and
 * config knobs; every field exists because a specific source's recon
 * verdict or sitemap shape demanded it.
 */
export interface SitemapCrawlOptions {
  readonly extractorConfig: ExtractorConfig;
  readonly productUrlPredicate: ProductUrlPredicate;
  /** No sitemap `lastmod` (drinkonline): every cycle is a full set. */
  readonly fullRefresh: boolean;
  readonly watermarkStore?: ILastmodWatermarkStore;
  /** In-flight crawl cursor backing (task 3.1); default in-memory. */
  readonly cursorStore?: ICrawlCursorStore;
  readonly fetcher?: PageFetcher;
  readonly sleep?: Sleep;
}

/** The injection surface tests (and task 3.1) substitute. */
export type SitemapCrawlWiring = Pick<
  SitemapCrawlOptions,
  'watermarkStore' | 'cursorStore' | 'fetcher' | 'sleep'
>;

export abstract class SitemapCrawlFeedAdapter implements IFeedAdapter {
  abstract readonly merchantId: string;

  private readonly options: SitemapCrawlOptions;
  private readonly watermarkStore: ILastmodWatermarkStore;
  private readonly cursorStore: ICrawlCursorStore;
  private readonly fetcher: PageFetcher;

  protected constructor(options: SitemapCrawlOptions) {
    this.options = options;
    this.watermarkStore =
      options.watermarkStore ?? new InMemoryLastmodWatermarkStore();
    this.cursorStore = options.cursorStore ?? new InMemoryCrawlCursorStore();
    this.fetcher = options.fetcher ?? defaultPageFetcher;
  }

  async fetch(config: {
    feedUrl: string;
    feedFormat: 'json' | 'xml' | 'csv';
  }): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    return runCrawlCycle({
      merchantId: this.merchantId,
      sitemapUrl: config.feedUrl,
      productUrlPredicate: this.options.productUrlPredicate,
      fullRefresh: this.options.fullRefresh,
      watermarkStore: this.watermarkStore,
      extractPage: (url, body) =>
        extractProductPage(url, body, this.options.extractorConfig),
      fetcher: this.fetcher,
      sleep: this.options.sleep,
    });
  }

  // -- Chunked protocol (task 3.1): the workflow drives these instead of
  // fetch() so a full crawl crosses durable step boundaries. Same cycle,
  // same stores, same politeness — only the step slicing differs.

  /**
   * Begin (or resume) the cycle: sitemap once → filter → lastmod diff →
   * cursor + watermark persisted. Store failures throw (the workflow
   * step retries); cycle-level failures come back collected.
   */
  async beginCrawlCycle(feedUrl: string): Promise<CrawlDiscoverOutcome> {
    return beginCrawlCycle({
      merchantId: this.merchantId,
      sitemapUrl: feedUrl,
      productUrlPredicate: this.options.productUrlPredicate,
      fullRefresh: this.options.fullRefresh,
      watermarkStore: this.watermarkStore,
      cursorStore: this.cursorStore,
      fetcher: this.fetcher,
    });
  }

  /** Walk the next ≤ 300-URL slice of the in-flight queue. */
  async crawlChunk(): Promise<CrawlChunkOutcome> {
    return walkCrawlChunk({
      merchantId: this.merchantId,
      cursorStore: this.cursorStore,
      extractPage: (url, body) =>
        extractProductPage(url, body, this.options.extractorConfig),
      fetcher: this.fetcher,
      sleep: this.options.sleep,
    });
  }

  /**
   * Move the cursor past the chunk whose records already committed;
   * the final chunk's advance ends the cycle.
   */
  async advanceCrawl(fetched: number, done: boolean): Promise<void> {
    return advanceCrawlCursor({
      merchantId: this.merchantId,
      cursorStore: this.cursorStore,
      fetched,
      done,
    });
  }
}

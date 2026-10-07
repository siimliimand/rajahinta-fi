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
 * @module SitemapCrawlAdapter
 */

import { runCrawlCycle } from '../crawl/crawl-cycle';
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
  readonly fetcher?: PageFetcher;
  readonly sleep?: Sleep;
}

/** The injection surface tests (and task 3.1) substitute. */
export type SitemapCrawlWiring = Pick<
  SitemapCrawlOptions,
  'watermarkStore' | 'fetcher' | 'sleep'
>;

export abstract class SitemapCrawlFeedAdapter implements IFeedAdapter {
  abstract readonly merchantId: string;

  private readonly options: SitemapCrawlOptions;
  private readonly watermarkStore: ILastmodWatermarkStore;
  private readonly fetcher: PageFetcher;

  protected constructor(options: SitemapCrawlOptions) {
    this.options = options;
    this.watermarkStore =
      options.watermarkStore ?? new InMemoryLastmodWatermarkStore();
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
}

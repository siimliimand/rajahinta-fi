/**
 * The scheduled sitemap crawl cycle (task 1.1, change
 * sitemap-crawl-merchants; designs D2/D4/D5).
 *
 * One cycle = fetch the sitemap once → keep only product URLs → diff
 * against the merchant's persisted lastmod watermark → walk the
 * changed/new pages politely → persist the next watermark. The
 * per-source adapter (task 2.1) supplies only its identity, sitemap
 * URL, product-URL predicate, refresh mode, extraction callback, and
 * the watermark store — the politeness, budget, and failure discipline
 * live here once, exactly as the WooCommerce Store API walk does for
 * the API-feed merchants.
 *
 * Failure discipline: every step's failures are collected into
 * `errors[]` (the `IFeedAdapter` must-not-throw contract). A sitemap
 * failure ends the cycle with nothing crawled and the watermark
 * untouched — crawling nothing on unknown sitemap state is safer than
 * crawling stale expectations. A watermark LOAD failure forces a full
 * crawl (an unknown diff state must re-verify everything); a SAVE
 * failure still returns the crawled records — the next cycle re-crawls
 * the full set rather than skipping pages it cannot prove unchanged.
 *
 * @module CrawlCycle
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

export interface CrawlCycleOptions {
  readonly merchantId: string;
  /** The registry feedUrl — the merchant's product sitemap. */
  readonly sitemapUrl: string;
  readonly productUrlPredicate: ProductUrlPredicate;
  /** Full-refresh source (no sitemap `lastmod`): every cycle is full. */
  readonly fullRefresh: boolean;
  readonly watermarkStore: ILastmodWatermarkStore;
  /** Extracts zero or one RawFeedRecord from a detail page. */
  readonly extractPage: PageProcessor;
  readonly fetcher: PageFetcher;
  readonly sleep?: Sleep;
  readonly minSpacingMs?: number;
  /** ≤ 300-fetch chunk bound (design D5); unset = no additional cap. */
  readonly maxFetches?: number;
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export async function runCrawlCycle(
  options: CrawlCycleOptions,
): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
  const label = options.merchantId;
  const sleep = options.sleep ?? defaultSleep;
  const errors: string[] = [];

  const sitemap = await fetchSitemap(options.sitemapUrl, options.fetcher);
  if (sitemap.errors.length > 0) {
    return { records: [], errors: [...errors, ...sitemap.errors] };
  }

  const productEntries = filterSitemapEntries(
    sitemap.entries,
    options.productUrlPredicate,
  );

  let previous: SitemapWatermark | null;
  try {
    previous = await options.watermarkStore.load(options.merchantId);
  } catch (err) {
    errors.push(
      `${label} watermark load failed (${errorOf(err)}) — crawling the full set`,
    );
    previous = null;
  }

  const { urlsToCrawl, nextWatermark } = diffSitemapEntries(
    previous ?? new Map<string, string | null>(),
    productEntries,
    { fullRefresh: options.fullRefresh },
  );

  const walk = await walkProductPages({
    errorLabel: label,
    urls: urlsToCrawl,
    processPage: options.extractPage,
    fetcher: options.fetcher,
    sleep,
    minSpacingMs: options.minSpacingMs ?? MIN_REQUEST_SPACING_MS,
    maxFetches: options.maxFetches,
  });
  errors.push(...walk.errors);

  try {
    await options.watermarkStore.save(options.merchantId, nextWatermark);
  } catch (err) {
    errors.push(`${label} watermark save failed: ${errorOf(err)}`);
  }

  return { records: walk.records, errors };
}

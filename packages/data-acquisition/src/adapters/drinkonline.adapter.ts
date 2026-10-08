/**
 * drinkonline.eu sitemap-crawl feed adapter (task 2.1, change
 * sitemap-crawl-merchants).
 *
 * A thin subclass of the shared crawl composition
 * (`sitemap-crawl.adapter.ts`). The recon verdict (design D3/D4)
 * makes drinkonline the full-refresh source — its sitemap exposes no
 * `lastmod`, so every cycle is a full set (≈ 1,838 pages, chunked and
 * paced by the walk) — and the offers-as-array JSON-LD is handled by
 * the reader tier, not a knob here. This file pins the merchantId
 * (task 2.2 seed, exact) and the product-URL predicate.
 *
 * Product locs are `/<category>/<slug>/` with a trailing slash and no
 * id (the page's `sku` becomes the productId); single-segment routes
 * and deeper CMS paths are dropped before the diff.
 *
 * @module DrinkonlineFeedAdapter
 */

import type { SitemapCrawlWiring } from './sitemap-crawl.adapter';
import { SitemapCrawlFeedAdapter } from './sitemap-crawl.adapter';
import { DRINKONLINE_EXTRACTOR_CONFIG } from '../crawl/extract/source-configs';
import { urlPatternPredicate } from '../crawl/product-url-filter';

export const DRINKONLINE_PRODUCT_URL_PATTERN =
  /^https:\/\/www\.drinkonline\.eu\/[^/]+\/[^/]+\/$/;

export class DrinkonlineFeedAdapter extends SitemapCrawlFeedAdapter {
  readonly merchantId = 'drinkonline';

  constructor(wiring: SitemapCrawlWiring = {}) {
    super({
      extractorConfig: DRINKONLINE_EXTRACTOR_CONFIG,
      productUrlPredicate: urlPatternPredicate(
        DRINKONLINE_PRODUCT_URL_PATTERN,
      ),
      fullRefresh: true,
      ...wiring,
    });
  }
}

/**
 * viinikauppa.com sitemap-crawl feed adapter (task 2.1, change
 * sitemap-crawl-merchants).
 *
 * A thin subclass of the shared crawl composition
 * (`sitemap-crawl.adapter.ts`). The recon verdict (design D3) makes
 * viinikauppa the trap source — JSON-LD whose `brand` is the store
 * name and whose ABV lives only in Finnish description prose — but
 * both knobs live in the extractor config (`VIINIKAUPPA_EXTRACTOR_
 * CONFIG`), not here. This file pins the merchantId (task 2.2 seed,
 * exact), the product-URL predicate, and the incremental refresh mode
 * (the xmlsitemap route carries `lastmod`).
 *
 * Product locs are single-segment slugs directly under `/catalog/`;
 * the sitemap route itself and CMS routes are multi-segment and
 * dropped before the lastmod diff.
 *
 * @module ViinikauppaFeedAdapter
 */

import type { SitemapCrawlWiring } from './sitemap-crawl.adapter';
import { SitemapCrawlFeedAdapter } from './sitemap-crawl.adapter';
import { VIINIKAUPPA_EXTRACTOR_CONFIG } from '../crawl/extract/source-configs';
import { urlPatternPredicate } from '../crawl/product-url-filter';

export const VIINIKAUPPA_PRODUCT_URL_PATTERN =
  /^https:\/\/www\.viinikauppa\.com\/catalog\/[^/]+$/;

export class ViinikauppaFeedAdapter extends SitemapCrawlFeedAdapter {
  readonly merchantId = 'viinikauppa';

  constructor(wiring: SitemapCrawlWiring = {}) {
    super({
      extractorConfig: VIINIKAUPPA_EXTRACTOR_CONFIG,
      productUrlPredicate: urlPatternPredicate(
        VIINIKAUPPA_PRODUCT_URL_PATTERN,
      ),
      fullRefresh: false,
      ...wiring,
    });
  }
}

/**
 * licorea.com sitemap-crawl feed adapter (task 2.1, change
 * sitemap-crawl-merchants).
 *
 * A thin subclass of the shared crawl composition
 * (`sitemap-crawl.adapter.ts`). The recon verdict (design D3) makes
 * licorea the complete-JSON-LD source (`gtin13`, price, currency,
 * availability — no fallback parsing), so the extractor config carries
 * no knobs. This file pins the merchantId (task 2.2 seed, exact), the
 * product-URL predicate, and the incremental refresh mode.
 *
 * EN storefront only: the registry feedUrl is already
 * `sitemapproducts_en.xml`, and the predicate keeps only the
 * `-en-p-<id>.html` detail shape — the `-es-`/`-de-` storefront twins
 * of the same product and CMS routes are dropped before the lastmod
 * diff.
 *
 * @module LicoreaFeedAdapter
 */

import type { SitemapCrawlWiring } from './sitemap-crawl.adapter';
import { SitemapCrawlFeedAdapter } from './sitemap-crawl.adapter';
import { LICOREA_EXTRACTOR_CONFIG } from '../crawl/extract/source-configs';
import { urlPatternPredicate } from '../crawl/product-url-filter';

export const LICOREA_PRODUCT_URL_PATTERN =
  /^https:\/\/www\.licorea\.com\/.+?-en-p-\d+\.html$/;

export class LicoreaFeedAdapter extends SitemapCrawlFeedAdapter {
  readonly merchantId = 'licorea';

  constructor(wiring: SitemapCrawlWiring = {}) {
    super({
      extractorConfig: LICOREA_EXTRACTOR_CONFIG,
      productUrlPredicate: urlPatternPredicate(LICOREA_PRODUCT_URL_PATTERN),
      fullRefresh: false,
      ...wiring,
    });
  }
}

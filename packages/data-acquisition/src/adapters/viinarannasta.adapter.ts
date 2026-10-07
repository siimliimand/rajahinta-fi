/**
 * viinarannasta.eu sitemap-crawl feed adapter (task 2.1, change
 * sitemap-crawl-merchants).
 *
 * A thin subclass of the shared crawl composition
 * (`sitemap-crawl.adapter.ts`). The recon verdict (design D3) makes
 * viinarannasta the microdata-tier source with GTIN13 — no extractor
 * knobs — so this file pins only the merchantId (task 2.2 seed,
 * exact), the product-URL predicate, and the incremental refresh mode
 * (its urlset carries `lastmod`).
 *
 * Product locs are PrestaShop detail pages
 * `/fi/<category-path>/<id>-<slug>.html`; the urlset also lists image
 * files and CMS routes, which the predicate drops BEFORE the lastmod
 * diff so they never enter the watermark either.
 *
 * @module ViinarannastaFeedAdapter
 */

import type { SitemapCrawlWiring } from './sitemap-crawl.adapter';
import { SitemapCrawlFeedAdapter } from './sitemap-crawl.adapter';
import { VIINARANNASTA_EXTRACTOR_CONFIG } from '../crawl/extract/source-configs';
import { urlPatternPredicate } from '../crawl/product-url-filter';

export const VIINARANNASTA_PRODUCT_URL_PATTERN =
  /^https:\/\/viinarannasta\.eu\/fi\/(?:.+\/)?\d+-[^/]+\.html$/;

export class ViinarannastaFeedAdapter extends SitemapCrawlFeedAdapter {
  readonly merchantId = 'viinarannasta';

  constructor(wiring: SitemapCrawlWiring = {}) {
    super({
      extractorConfig: VIINARANNASTA_EXTRACTOR_CONFIG,
      productUrlPredicate: urlPatternPredicate(
        VIINARANNASTA_PRODUCT_URL_PATTERN,
      ),
      fullRefresh: false,
      ...wiring,
    });
  }
}

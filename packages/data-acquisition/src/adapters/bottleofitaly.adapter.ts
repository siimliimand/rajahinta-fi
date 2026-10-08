/**
 * bottleofitaly.com feed adapter (task 3.1, change
 * onboard-shopify-lmdw-merchants; design D1 — the first Shopify
 * merchant, on the shared products.json walk).
 *
 * bottleofitaly.com is an Italian Shopify store the operator holds
 * usage rights to (governance source `RETAILER_API`, design D8). The
 * walk discipline (sequential `limit=250` pages, short-page
 * termination for the absent total-pages header, per-page failures
 * collected never thrown) lives in `shopify-products.walk.ts`; this
 * class pins only what is BOI's: the merchantId, the error-label
 * prefix, and the sweep-proven parser (task 3.1, `parseBottleofItalyProducts`)
 * as the `parseProducts` hook. The golden BOI fixtures pin the sweep
 * reality end to end through this subclass.
 *
 * @module BottleofItalyFeedAdapter
 */

import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { parseBottleofItalyProducts } from './bottleofitaly.parser';
import { ShopifyProductsFeedAdapter } from './shopify-products.walk';

export class BottleofItalyFeedAdapter extends ShopifyProductsFeedAdapter {
  readonly merchantId = 'bottleofitaly';

  constructor() {
    super({ errorLabelPrefix: 'bottleofitaly' });
  }

  protected parseProducts(
    rows: readonly unknown[],
  ): { records: RawFeedRecord[]; errors: string[] } {
    return parseBottleofItalyProducts(rows);
  }
}

/**
 * kuhns.shop feed adapter (task 3.2, change
 * onboard-shopify-lmdw-merchants; designs D1/D2/D3).
 *
 * Walks the Shopify products.json collection
 * (`<feedUrl>/products.json`) page by page through the shared walk
 * (`shopify-products.walk.ts`, task 2.1) and feeds each raw row through
 * the pure parser (`kuhns.parser.ts`), whose per-row correction-error
 * discipline the shared walk preserves verbatim: rows are never dropped
 * for a parse failure they can survive (the ML-shaped SKU that keeps
 * every row EAN-less, unparsed ABV/volume through the keyed-uncertainty
 * ESTIMATED path), only for structural invalidity or a category
 * contradiction — always with an error naming them.
 *
 * The walk discipline (sequential pages, short-page termination,
 * per-page failures collected never thrown, design D7) lives in the
 * shared walk; this class pins only what is kuhns's: the merchantId,
 * the error-label prefix, and the parser hook. The golden kuhns
 * fixtures pin the sweep reality end to end through this subclass.
 *
 * @module KuhnsFeedAdapter
 */

import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { ShopifyProductsFeedAdapter } from './shopify-products.walk';
import { parseKuhnsProducts } from './kuhns.parser';

export class KuhnsFeedAdapter extends ShopifyProductsFeedAdapter {
  readonly merchantId = 'kuhns';

  constructor() {
    super({ errorLabelPrefix: 'kuhns' });
  }

  protected parseProducts(
    rows: readonly unknown[],
  ): { records: RawFeedRecord[]; errors: string[] } {
    return parseKuhnsProducts(rows);
  }
}

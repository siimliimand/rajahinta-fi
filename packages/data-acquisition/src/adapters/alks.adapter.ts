/**
 * alks.fi feed adapter (task 1.2, change alks-feed-and-import-vat;
 * designs D1/D2/D3/D7; reworked as a thin subclass in task 2.2, change
 * onboard-kippis-merchant).
 *
 * Walks the WooCommerce Store API collection
 * (`<feedUrl>/wp-json/wc/store/v1/products`) page by page and feeds each
 * row through the pure parser (`alks.parser.ts`), whose per-row
 * correction-error discipline the shared walk preserves verbatim: rows
 * are never dropped for a parse failure they can survive (non-matching
 * SKU, unparsed ABV/volume), only for structural invalidity or a
 * category contradiction — always with an error naming them.
 *
 * The pagination discipline, the degradation behavior, and the EUR-only
 * rule live in the shared walk (`woo-store.adapter.ts`); this class
 * pins only what is alks's: the merchantId, the error-label prefix, and
 * the collection path. The golden alks fixtures continue to pin the
 * walk end to end through this subclass.
 *
 * @module AlksFeedAdapter
 */

import { WOO_STORE_API_PATH, WooStoreFeedAdapter } from './woo-store.adapter';

export class AlksFeedAdapter extends WooStoreFeedAdapter {
  readonly merchantId = 'alks';

  constructor() {
    super({ errorLabelPrefix: 'alks', storeApiPath: WOO_STORE_API_PATH });
  }
}

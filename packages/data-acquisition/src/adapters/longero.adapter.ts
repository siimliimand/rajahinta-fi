/**
 * longero.fi feed adapter (task 2.1, change onboard-longero-merchant;
 * reworked as a thin subclass in task 2.2, change
 * onboard-kippis-merchant).
 *
 * longero.fi is a WooCommerce Store API whose payload is field-for-field
 * compatible with alks's (EAN-shaped SKUs, EUR minor-unit prices,
 * name-embedded ABV/volume, `X-WP-TotalPages` pagination), so every row
 * is fed through the existing parser (`parseAlksStoreProducts`, reused
 * unchanged — no parser rename or extraction). The rule-of-three comment
 * this file used to carry ("generalization waits for a third WooCommerce
 * merchant") is resolved by kippis: the walk now lives once in the
 * shared module (`woo-store.adapter.ts`), and longero is a thin subclass
 * pinning only its merchantId, error-label prefix, and collection path.
 * The golden longero fixtures continue to pin the walk end to end
 * through this subclass.
 *
 * Scraping rights: documented — governance source `RETAILER_API`
 * (public WooCommerce Store API). The merchant is operated by
 * TOVAGLUKE OÜ (Estonia; registry country `EE` — the `.fi` domain is
 * misleading), and fetching stays gated behind a `GRANTED` governance
 * record. Foreign-merchant tax model: EUR-native with no FX conversion
 * — a non-EUR row is rejected per-row by the parser (Posti precedent),
 * not converted here.
 *
 * @module LongeroFeedAdapter
 */

import { WOO_STORE_API_PATH, WooStoreFeedAdapter } from './woo-store.adapter';

export class LongeroFeedAdapter extends WooStoreFeedAdapter {
  readonly merchantId = 'longero';

  constructor() {
    super({ errorLabelPrefix: 'longero', storeApiPath: WOO_STORE_API_PATH });
  }
}

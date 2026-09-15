/**
 * kippis.net feed adapter (task 2.2, change onboard-kippis-merchant;
 * design D1 — the third WooCommerce merchant).
 *
 * kippis.net is a WooCommerce Store API whose payload matches the alks
 * shape field for field: EUR minor-unit strings in `prices.price` with
 * the effective SALE price already in that field (no separate sale flag
 * to reconcile — the parser reads one price), `all type: simple` rows,
 * name-embedded ABV/volume with Finnish comma decimals (`41,7% 0,5 l`),
 * and the Finnish department vocabulary the sweep mapped additively
 * (task 1.2: `Valkoviinit`, `punaviinit`, `Vodkat ja Viinat`, …). SKUs
 * are numeric and unprefixed — bare 13-digit EANs and GTIN-14 forms both
 * accepted by `readEanFromSku` as of task 2.1; 12-digit numerics,
 * internal codes, and suffixed variants stay EAN-less with a correction
 * error (design D1 — never guessed around).
 *
 * The walk discipline, the degradation behavior, and the EUR-only rule
 * live in the shared walk (`woo-store.adapter.ts`); this class pins only
 * what is kippis's: the merchantId, the error-label prefix, and the
 * collection path. The golden kippis fixtures pin the sweep reality end
 * to end through this subclass.
 *
 * Scraping rights: documented — governance source `RETAILER_API`
 * (public WooCommerce Store API), gated behind a `GRANTED` governance
 * record. EUR-native with no FX conversion — a non-EUR row is rejected
 * per-row by the parser (Posti precedent), not converted here.
 *
 * @module KippisFeedAdapter
 */

import { WOO_STORE_API_PATH, WooStoreFeedAdapter } from './woo-store.adapter';

export class KippisFeedAdapter extends WooStoreFeedAdapter {
  readonly merchantId = 'kippis';

  constructor() {
    super({ errorLabelPrefix: 'kippis', storeApiPath: WOO_STORE_API_PATH });
  }
}

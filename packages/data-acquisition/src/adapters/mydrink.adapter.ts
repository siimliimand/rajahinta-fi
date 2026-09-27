/**
 * mydrink.ee feed adapter (task 2.1, change onboard-mydrink-merchant;
 * design D1 — the fourth WooCommerce merchant).
 *
 * mydrink.ee is an Estonian WooCommerce Store API owned by the
 * operator, with documented scraping rights (governance source
 * `RETAILER_API`, gated behind a `GRANTED` governance record). Its
 * payload is field-for-field compatible with the alks Store API shape:
 * EUR minor-unit strings in `prices.price` with the effective SALE
 * price already in that field (sale rows carry the crossed-out
 * `regular_price` alongside, which the parser never reads), all
 * `type: simple` rows, name-embedded ABV/volume with Estonian comma
 * decimals (`4,7% 0,5L`), and `brands` empty on every row — the owner
 * confirmed the catalog carries no brand data, so records keep an
 * empty brand and the upsert's compound tier carries the match (D4).
 *
 * Every SKU is an internal code (`MTBE026-1-2-1` shape): none matches
 * an accepted EAN form, so 100 % of rows ingest EAN-less with the
 * parser's per-row correction error (design D2 — never guessed
 * around; the correction-log volume is accepted). Estonian category
 * terms map additively through task 1.2's sweep vocabulary; the
 * `veinid ▾` parent stays unmapped so still-vs-sparkling wine
 * resolves from leaf terms only (design D3). `depositSystem` stays
 * false: the feed's `Pandipakend` attribute describes the Estonian
 * deposit system, not Finnish pantti membership (design D5).
 *
 * The walk discipline, the degradation behavior, and the EUR-only
 * rule live in the shared walk (`woo-store.adapter.ts`); this class
 * pins only what is mydrink's: the merchantId, the error-label
 * prefix, and the collection path. The golden mydrink fixtures pin
 * the sweep reality end to end through this subclass.
 *
 * @module MydrinkFeedAdapter
 */

import { WOO_STORE_API_PATH, WooStoreFeedAdapter } from './woo-store.adapter';

export class MydrinkFeedAdapter extends WooStoreFeedAdapter {
  readonly merchantId = 'mydrink';

  constructor() {
    super({ errorLabelPrefix: 'mydrink', storeApiPath: WOO_STORE_API_PATH });
  }
}

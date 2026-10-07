/**
 * araxes.ee feed adapter (task 2.1, change onboard-araxes-merchant;
 * design D1 — the fifth WooCommerce merchant).
 *
 * araxes.ee is an Estonian WooCommerce Store API the operator holds
 * usage rights to (governance source `RETAILER_API`, gated behind a
 * `GRANTED` governance record). Its payload is field-for-field
 * compatible with the alks Store API shape: EUR minor-unit strings in
 * `prices.price` with the effective SALE price already in that field
 * (sale rows carry the crossed-out `regular_price` and the matching
 * `sale_price` alongside, which the parser never reads), all
 * `type: simple` rows, name-embedded ABV/volume, and `brands` empty on
 * every row (100 % of the sweep census) — records keep an empty brand
 * and the upsert's compound tier carries the match (design D4).
 *
 * Every SKU is a short internal code (`42631` shape): none matches an
 * accepted EAN form, so 100 % of rows ingest EAN-less with the
 * parser's per-row correction error (design D2 — never guessed
 * around; the ~1,630 correction lines per daily run are accepted log
 * noise, 2× mydrink's volume). Estonian category terms arrive BARE
 * (undecorated) and map additively through task 1.2's sweep
 * vocabulary — the mydrink keys (`kange alkohol ▾`, `punased`,
 * `vahuveinid`) are decorated/plural and stay untouched; the wine
 * parent `Vein` stays unmapped so still-vs-sparkling resolves from
 * leaf terms only (design D3). `depositSystem` stays false: the
 * feed's `Pant` attribute describes the Estonian deposit system, not
 * Finnish pantti membership (design D5). The structured attributes
 * (`Maht`, `Alkoholisisaldus`, `Päritolumaa`, …) are unread this
 * change — the parser reads names only (sweep ESTIMATED share 4.5 %;
 * the attribute-aware follow-up is design D1's escape hatch).
 *
 * The walk discipline, the degradation behavior, and the EUR-only
 * rule live in the shared walk (`woo-store.adapter.ts`); this class
 * pins only what is araxes's: the merchantId, the error-label
 * prefix, and the collection path. The golden araxes fixtures pin
 * the sweep reality end to end through this subclass.
 *
 * @module AraxesFeedAdapter
 */

import { WOO_STORE_API_PATH, WooStoreFeedAdapter } from './woo-store.adapter';

export class AraxesFeedAdapter extends WooStoreFeedAdapter {
  readonly merchantId = 'araxes';

  constructor() {
    super({ errorLabelPrefix: 'araxes', storeApiPath: WOO_STORE_API_PATH });
  }
}

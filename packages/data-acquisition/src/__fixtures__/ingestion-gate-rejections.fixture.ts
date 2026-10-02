/**
 * Golden failure-shape fixtures for the ingestion plausibility gates
 * (task 1.4, change data-quality-and-publication-trust).
 *
 * The wave-1 gates each landed with unit tests over synthetic rows; this
 * fixture pins the gates against the OBSERVED failure shapes instead, so
 * the contract holds for the class and not only for the recorded
 * incidents. All rows share the alks.fi Store API payload contract
 * (the feed every incident came from) and reuse its fixture row type —
 * these are contract rows, not production data: names follow the
 * recorded live shapes, amounts are invented.
 *
 * One row per observed failure shape, plus one well-formed control:
 *
 * - zero price — the recorded price-drift incident (champagne row
 *   carrying `"0"`). Gate: the mapping-layer price floor
 *   (data-mapping.service.ts, task 1.1) — the offer is never published,
 *   the product upserts offer-less.
 * - category-implausible volume — the live "Karhu Olut 5.3% 24×33 l"
 *   33-litre beer shape. The multipack parser (task 1.3) yields the pack
 *   total (33 l, pack count 24); the mapping-layer pack-notation
 *   normalizer (task 1.1, change honest-trust-surfaces) reads the name
 *   as 24 × 33 cl and stores 0.33, so the row reaches the downstream
 *   volume-ceiling gate (api-worker ingestion-steps.ts, task 1.2)
 *   plausible.
 * - bundle name — the live "… + Jägermeister 0" concatenation. Gate:
 *   the parser (alks.parser.ts, task 1.3) — the row is held for review
 *   with no record, so nothing with arbitrarily parsed ABV/volume can
 *   publish.
 * - stacked — volume AND zero price on one row: the gates must compose
 *   (the ceiling copy preserves the mapper's offer rejection — an offer
 *   the price floor rejected is never resurrected). At the mapping layer
 *   the volume half now normalizes to a plausible 0.33 (task 1.1,
 *   honest-trust-surfaces); the composition over a TRUE implausible
 *   volume is pinned in the api-worker workflow tests.
 *
 * The pipeline contract test consuming this fixture lives in
 * `__tests__/pipeline-gate-contract.test.ts`.
 *
 * @module IngestionGateRejectionsFixture
 */

import type { AlksFixtureProduct } from '../adapters/__fixtures__/alks-store-products.fixture';

/**
 * The failure-shape rows in contract-test order. Frozen shape, frozen
 * content — accidental edits fail loudly, like every golden fixture.
 */
export const ALKS_GATE_REJECTION_PRODUCTS: readonly AlksFixtureProduct[] = [
  // Control — a well-formed beer that must keep publishing product and
  // offer unchanged: the gates reject a class of rows, not the feed.
  {
    id: 757100,
    name: 'Kulbrau Pilsner 4.8% 0,5 l',
    sku: 'de-4260123456789',
    permalink: 'https://alks.fi/product/kulbrau-pilsner-4-8-0-5-l/',
    prices: { price: '549', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }, { name: 'Beer' }],
    brands: [{ name: 'Kulbrau' }],
    is_in_stock: true,
  },
  // Zero price — price "0" exactly as the feed carries it (minor-unit
  // string). The parser keeps the row (zero IS an integer); the
  // mapping-layer price floor rejects the offer with the source value
  // named. Name/categories agree on sparkling wine so the price floor
  // is the ONLY gate this row exercises.
  {
    id: 757101,
    name: 'R de Ruinart Champagne 12% 0,75 l',
    sku: 'fr-3458867000206',
    permalink: 'https://alks.fi/product/r-de-ruinart-champagne-12-0-75-l/',
    prices: { price: '0', currency_code: 'EUR' },
    categories: [{ name: 'Kuohuviini' }],
    weight: '1.5',
    is_in_stock: true,
  },
  // Category-implausible volume — the live 33-litre beer shape. The
  // parser yields the pack total (33 l, pack count 24); the mapping
  // normalizer (honest-trust-surfaces task 1.1) reads the name as
  // 24 × 33 cl → 0.33 per unit, satisfying the beer ceiling the
  // downstream gate enforces.
  {
    id: 757102,
    name: 'Karhu Olut 5.3% 24×33 l',
    sku: 'ee-6412700071701',
    permalink: 'https://alks.fi/product/karhu-olut-5-3-24x33-l/',
    prices: { price: '2999', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
    is_in_stock: true,
  },
  // Stacked — the incident shape carries a pack total AND a zero price.
  // At this layer the price floor is the gate that fires (the volume
  // normalizes to a plausible 0.33); no gate may resurrect what another
  // rejected — pinned over a true implausible volume in the api-worker
  // workflow tests.
  {
    id: 757103,
    name: 'Karin Munk Olut 4,7% 24×33 l',
    sku: 'ee-6410405103177',
    permalink: 'https://alks.fi/product/karin-munk-olut-4-7-24x33-l/',
    prices: { price: '0', currency_code: 'EUR' },
    categories: [{ name: 'Olut' }],
    is_in_stock: true,
  },
  // Bundle name — a second product concatenated onto the name
  // ("… + Jägermeister 0"): no honest single ABV/volume exists, so the
  // row is held for review before anything is mapped.
  {
    id: 757104,
    name: 'Koskenkorva Vodka 40% 0,5 l + Jägermeister 0',
    sku: 'ee-6410405103184',
    permalink: 'https://alks.fi/product/koskenkorva-vodka-40-0-5-l-jaegermeister-0/',
    prices: { price: '3499', currency_code: 'EUR' },
    categories: [{ name: 'Väkevä' }],
    is_in_stock: true,
  },
];

/** Row lookup by failure shape — the contract test never indexes blind. */
export const ALKS_GATE_REJECTION_ROW = {
  control: 0,
  zeroPrice: 1,
  implausibleVolume: 2,
  stackedVolumeAndZeroPrice: 3,
  bundleName: 4,
} as const;

/**
 * The golden payload — a Store API page is a top-level JSON array.
 * Frozen so accidental fixture edits fail loudly.
 */
export const ALKS_GATE_REJECTION_PAYLOAD: readonly AlksFixtureProduct[] =
  Object.freeze(ALKS_GATE_REJECTION_PRODUCTS);

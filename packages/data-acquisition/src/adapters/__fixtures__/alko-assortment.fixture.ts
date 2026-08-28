/**
 * Golden dataset for the Alko assortment parser (task 7.5, design D6/D7).
 *
 * Pins the payload contract documented in adapters/alko.adapter.ts: the
 * domestic reference feed is an EUR price list whose Finnish assortment
 * groups map through the source-category normalization. There is no
 * live API entitlement — this fixture IS the contract. When a real
 * feed is wired, parser drift against reality shows up as a golden-test
 * failure instead of a silent data outage.
 *
 * The set deliberately exercises every mapping branch the parser owns:
 * beer/wine/sparkling/spirits/cider/long-drink categories, one
 * unmappable category (rejected per-item to the correction queue), one
 * price-less row (rejected — a reference offer without an amount is
 * unusable), and a zero-ABV product.
 *
 * @module AlkoAssortmentFixture
 */

export interface AlkoFixtureProduct {
  readonly productId: string;
  readonly name: string;
  readonly manufacturer: string;
  readonly productGroup: string;
  readonly alcoholPercentage: number;
  readonly volumeMl: number;
  readonly price: number;
  readonly packagingType: string;
  readonly ean: string;
}

export interface AlkoFixturePayload {
  readonly source: 'alko';
  readonly currency: 'EUR';
  readonly products: readonly AlkoFixtureProduct[];
}

export const ALKO_GOLDEN_PRODUCTS: readonly AlkoFixtureProduct[] = [
  {
    productId: '000001',
    name: 'Lapin Kulta',
    manufacturer: 'Hartwall',
    productGroup: 'Olut',
    alcoholPercentage: 4.5,
    volumeMl: 450,
    price: 1.95,
    packagingType: 'Tölkki',
    ean: '6411000000018',
  },
  {
    productId: '000002',
    name: 'Koff III',
    manufacturer: 'Sinebrychooff',
    productGroup: 'Olut',
    alcoholPercentage: 4.5,
    volumeMl: 330,
    price: 1.55,
    packagingType: 'Pullo',
    ean: '6411000000025',
  },
  {
    productId: '000003',
    name: 'Hard Rock Cafe Siideri',
    manufacturer: 'Hartwall',
    productGroup: 'Siideri',
    alcoholPercentage: 4.7,
    volumeMl: 330,
    price: 2.25,
    packagingType: 'Pullo',
    ean: '6411000000032',
  },
  {
    productId: '000004',
    name: 'Rocher La Pigeonne',
    manufacturer: 'Les Vignerons',
    productGroup: 'Viini',
    alcoholPercentage: 12.5,
    volumeMl: 750,
    price: 8.97,
    packagingType: 'Pullo',
    ean: '6411000000049',
  },
  {
    productId: '000005',
    name: 'Freixenet Cordon Negro',
    manufacturer: 'Freixenet',
    productGroup: 'Kuohuviini',
    alcoholPercentage: 11.5,
    volumeMl: 200,
    price: 4.98,
    packagingType: 'Pullo',
    ean: '6411000000056',
  },
  {
    productId: '000006',
    name: 'Koskenkorva Viina',
    manufacturer: 'Altia',
    productGroup: 'Viina',
    alcoholPercentage: 38.0,
    volumeMl: 500,
    price: 16.99,
    packagingType: 'Pullo',
    ean: '6411000000063',
  },
  {
    productId: '000007',
    name: 'Original Long Drink',
    manufacturer: 'Sinebrychooff',
    productGroup: 'Lonkero',
    alcoholPercentage: 5.5,
    volumeMl: 500,
    price: 2.95,
    packagingType: 'Tölkki',
    ean: '6411000000070',
  },
  {
    productId: '000008',
    name: 'Iki Kuohuviini Alkoholiton',
    manufacturer: 'Altia',
    productGroup: 'Kuohuviini',
    alcoholPercentage: 0.0,
    volumeMl: 750,
    price: 6.49,
    packagingType: 'Pullo',
    ean: '6411000000087',
  },
  // Unmappable assortment group — per-item rejection to the correction
  // queue; a fallback category assignment is forbidden by the
  // product-normalization spec.
  {
    productId: '000009',
    name: 'Mysteerijuoma',
    manufacturer: 'Tuntematon',
    productGroup: 'Juomasekoitukset ja muut',
    alcoholPercentage: 12.0,
    volumeMl: 500,
    price: 21.99,
    packagingType: 'Pullo',
    ean: '6411000000094',
  },
  // Reference offer without a usable amount — rejected per-item.
  {
    productId: '000010',
    name: 'Hinnaton',
    manufacturer: 'Tuntematon',
    productGroup: 'Viini',
    alcoholPercentage: 13.0,
    volumeMl: 750,
    price: 0,
    packagingType: 'Pullo',
    ean: '6411000000100',
  },
];

/** The golden payload — frozen so accidental fixture edits fail loudly. */
export const ALKO_GOLDEN_PAYLOAD: AlkoFixturePayload = Object.freeze({
  source: 'alko',
  currency: 'EUR',
  products: Object.freeze(ALKO_GOLDEN_PRODUCTS),
});

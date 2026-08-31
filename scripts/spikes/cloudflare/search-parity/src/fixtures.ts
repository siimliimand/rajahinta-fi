/**
 * G2 search parity spike — product fixtures.
 *
 * PROVENANCE (the task requires noting where fixtures came from):
 *
 * 1. Rows 10/20/30/31 are copied verbatim from the search-controller unit
 *    fixtures in
 *    packages/application-api/src/search/__tests__/search.controller.test.ts
 *    (PROD_Z, PROD_A, PROD_KARHU_NAME, PROD_KARHU_BRAND).
 *
 * 2. Rows 40/41/42 are the seed rows of the PostgreSQL integration test
 *    packages/application-api/src/search/__tests__/product-search.db.test.ts
 *    (SEED_PRODUCTS, including the literal '(ranked-search-test)' marker);
 *    ids 40-42 are synthetic — the pg test lets serials assign them.
 *
 * 3. Rows 50+ are synthetic but realistic Finnish/Swedish beverage
 *    names/brands so the extra parity queries exercise real-world
 *    token shapes (compound Finnish words, Å/Ä/Ö, multi-token brands).
 *
 * @module G2SpikeFixtures
 */

export interface ProductFixture {
  readonly id: number;
  readonly name: string;
  readonly manufacturer: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: string | null;
  readonly unitVolume: string;
  readonly containerType: string;
  readonly regulatoryClassification: string;
  readonly depositSystemStatus: boolean | null;
  readonly ean: string | null;
}

/** Search-controller fixtures (provenance 1) — ids match the test file. */
const CONTROLLER_TEST_FIXTURES: ProductFixture[] = [
  {
    id: 10,
    name: 'Öltermanni Olut',
    manufacturer: 'Panimo Oy',
    brand: 'Öltermanni',
    category: 'beer',
    alcoholByVolume: '0.047',
    unitVolume: '0.33',
    containerType: 'bottle',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: '0642000123456',
  },
  {
    id: 20,
    name: 'A. Le Coq Premium',
    manufacturer: 'A. Le Coq',
    brand: 'A. Le Coq',
    category: 'beer',
    alcoholByVolume: '0.050',
    unitVolume: '0.50',
    containerType: 'bottle',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: '0642000654321',
  },
  {
    id: 30,
    name: 'Karhu III',
    manufacturer: 'Hartwall',
    brand: 'Karhu',
    category: 'beer',
    alcoholByVolume: '0.045',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0641000111111',
  },
  {
    id: 31,
    name: 'Tumma Lager',
    manufacturer: 'Hartwall',
    brand: 'Karhu',
    category: 'beer',
    alcoholByVolume: '0.045',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0641000222222',
  },
];

/** Ranked-search DB-test fixtures (provenance 2) — marker kept verbatim. */
const DB_TEST_FIXTURES: ProductFixture[] = [
  {
    id: 40,
    name: 'Karhu III (ranked-search-test)',
    manufacturer: 'Hartwall',
    brand: 'Karhu',
    category: 'beer',
    alcoholByVolume: '0.045',
    unitVolume: '0.3300',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: null,
  },
  {
    id: 41,
    name: 'Tumma Lager Erityis (ranked-search-test)',
    manufacturer: 'Hartwall',
    brand: 'Karhu',
    category: 'beer',
    alcoholByVolume: '0.045',
    unitVolume: '0.3300',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: null,
  },
  {
    id: 42,
    name: 'Koff III (ranked-search-test)',
    manufacturer: 'Sinebrychoff',
    brand: 'Koff',
    category: 'beer',
    alcoholByVolume: '0.045',
    unitVolume: '0.3300',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: null,
  },
];

/** Realistic Finnish/Swedish extras (provenance 3) — synthetic ids 50+. */
const REALISTIC_EXTRAS: ProductFixture[] = [
  {
    id: 50,
    name: 'Olvi Sandels IVA',
    manufacturer: 'Olvi',
    brand: 'Sandels',
    category: 'beer',
    alcoholByVolume: '0.047',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0641000444444',
  },
  {
    id: 51,
    name: 'Norrlands Guld',
    manufacturer: 'Spendrups',
    brand: 'Norrlands Guld',
    category: 'beer',
    alcoholByVolume: '0.053',
    unitVolume: '0.50',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: '0731000111111',
  },
  {
    id: 52,
    name: 'Lapin Kulta Ivalo',
    manufacturer: 'Hartwall',
    brand: 'Lapin Kulta',
    category: 'beer',
    alcoholByVolume: '0.043',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0641000555555',
  },
  {
    id: 53,
    name: 'Long Drink Original',
    manufacturer: 'Hartwall',
    brand: 'Hartwall',
    category: 'other',
    alcoholByVolume: '0.085',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'other',
    depositSystemStatus: true,
    ean: '0641000666666',
  },
  {
    id: 54,
    name: 'Falcon Husmanslager',
    manufacturer: 'Falcon Husmans',
    brand: 'Falcon',
    category: 'beer',
    alcoholByVolume: '0.052',
    unitVolume: '0.50',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: false,
    ean: '0731000222222',
  },
  {
    id: 55,
    name: 'Koff 3.5 % Olut',
    manufacturer: 'Sinebrychoff',
    brand: 'Koff',
    category: 'beer',
    alcoholByVolume: '0.035',
    unitVolume: '0.33',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '0641000777777',
  },
  {
    id: 56,
    name: 'Renat Brännvin',
    manufacturer: 'Vin & Sprit',
    brand: 'Renat',
    category: 'spirits',
    alcoholByVolume: '0.375',
    unitVolume: '0.50',
    containerType: 'glass',
    regulatoryClassification: 'spirits',
    depositSystemStatus: null,
    ean: '0731000333333',
  },
];

export const FIXTURES: readonly ProductFixture[] = [
  ...CONTROLLER_TEST_FIXTURES,
  ...DB_TEST_FIXTURES,
  ...REALISTIC_EXTRAS,
];

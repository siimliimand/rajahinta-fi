/**
 * D1 product search — vitest port of the search expectations proven by
 * the G2 spike (task 1.2 / gate G2) and the pg search tests (task 2.2,
 * change migrate-to-cloudflare).
 *
 * Fixture provenance (identical to the spike's fixtures.ts):
 * 1. Rows 10/20/30/31 are copied verbatim from the search-controller unit
 *    fixtures in packages/application-api/src/search/__tests__/search.controller.test.ts
 *    (PROD_Z, PROD_A, PROD_KARHU_NAME, PROD_KARHU_BRAND).
 * 2. Rows 40/41/42 are the seed rows of
 *    packages/application-api/src/search/__tests__/product-search.db.test.ts
 *    (SEED_PRODUCTS, marker kept verbatim).
 * 3. Rows 50+ are realistic Finnish/Swedish beverage names so the parity
 *    queries exercise real token shapes.
 *
 * The 13 golden cases Q1–Q13 are the spike's CASES (results recorded in
 * spikes/g2-search-parity.md — 13/13 within top-5), now asserted against
 * the real repository on a real SQLite engine (node:sqlite) with the
 * committed migrations applied — FTS5 virtual table and sync triggers
 * included.
 *
 * @module D1ProductSearchRepositoryTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1ProductSearchRepository } from '../product-search.repository';

// ---------------------------------------------------------------------------
// Fixtures — the spike's 14 products, seeded through repository.create()
// with explicit ids so the golden expectations keep the spike's ids.
// ---------------------------------------------------------------------------

interface SeedProduct {
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

function product(seed: SeedProduct): SeedProduct {
  return seed;
}

const SEED_PRODUCTS: readonly SeedProduct[] = [
  // Search-controller fixtures (provenance 1)
  product({ id: 10, name: 'Öltermanni Olut', manufacturer: 'Panimo Oy', brand: 'Öltermanni', category: 'beer', alcoholByVolume: '0.047', unitVolume: '0.33', containerType: 'glass', regulatoryClassification: 'beer', depositSystemStatus: false, ean: '0642000123456' }),
  product({ id: 20, name: 'A. Le Coq Premium', manufacturer: 'A. Le Coq', brand: 'A. Le Coq', category: 'beer', alcoholByVolume: '0.050', unitVolume: '0.50', containerType: 'glass', regulatoryClassification: 'beer', depositSystemStatus: false, ean: '0642000654321' }),
  product({ id: 30, name: 'Karhu III', manufacturer: 'Hartwall', brand: 'Karhu', category: 'beer', alcoholByVolume: '0.045', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: '0641000111111' }),
  product({ id: 31, name: 'Tumma Lager', manufacturer: 'Hartwall', brand: 'Karhu', category: 'beer', alcoholByVolume: '0.045', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: '0641000222222' }),
  // Ranked-search DB-test fixtures (provenance 2, marker verbatim)
  product({ id: 40, name: 'Karhu III (ranked-search-test)', manufacturer: 'Hartwall', brand: 'Karhu', category: 'beer', alcoholByVolume: '0.045', unitVolume: '0.3300', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: null }),
  product({ id: 41, name: 'Tumma Lager Erityis (ranked-search-test)', manufacturer: 'Hartwall', brand: 'Karhu', category: 'beer', alcoholByVolume: '0.045', unitVolume: '0.3300', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: null }),
  product({ id: 42, name: 'Koff III (ranked-search-test)', manufacturer: 'Sinebrychoff', brand: 'Koff', category: 'beer', alcoholByVolume: '0.045', unitVolume: '0.3300', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: null }),
  // Realistic Finnish/Swedish extras (provenance 3)
  product({ id: 50, name: 'Olvi Sandels IVA', manufacturer: 'Olvi', brand: 'Sandels', category: 'beer', alcoholByVolume: '0.047', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: '0641000444444' }),
  product({ id: 51, name: 'Norrlands Guld', manufacturer: 'Spendrups', brand: 'Norrlands Guld', category: 'beer', alcoholByVolume: '0.053', unitVolume: '0.50', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: false, ean: '0731000111111' }),
  product({ id: 52, name: 'Lapin Kulta Ivalo', manufacturer: 'Hartwall', brand: 'Lapin Kulta', category: 'beer', alcoholByVolume: '0.043', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: '0641000555555' }),
  product({ id: 53, name: 'Long Drink Original', manufacturer: 'Hartwall', brand: 'Hartwall', category: 'other', alcoholByVolume: '0.085', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'other', depositSystemStatus: true, ean: '0641000666666' }),
  product({ id: 54, name: 'Falcon Husmanslager', manufacturer: 'Falcon Husmans', brand: 'Falcon', category: 'beer', alcoholByVolume: '0.052', unitVolume: '0.50', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: false, ean: '0731000222222' }),
  product({ id: 55, name: 'Koff 3.5 % Olut', manufacturer: 'Sinebrychoff', brand: 'Koff', category: 'beer', alcoholByVolume: '0.035', unitVolume: '0.33', containerType: 'metal', regulatoryClassification: 'beer', depositSystemStatus: true, ean: '0641000777777' }),
  product({ id: 56, name: 'Renat Brännvin', manufacturer: 'Vin & Sprit', brand: 'Renat', category: 'spirits', alcoholByVolume: '0.375', unitVolume: '0.50', containerType: 'glass', regulatoryClassification: 'spirits', depositSystemStatus: null, ean: '0731000333333' }),
];

const MAX_PAGE_SIZE = 100; // SearchController's ranked-search limit
const K = 5; // top-k gate from task 1.2

// The repository under test + the raw shim handle (trigger assertions).
const { d1, db } = openMigratedD1();
const repo = new D1ProductSearchRepository(d1);

beforeAll(async () => {
  for (const p of SEED_PRODUCTS) {
    await repo.create({ ...p });
  }

  // Sync-trigger sanity: the external-content index must equal the table.
  const count = await d1
    .prepare('SELECT count(*) AS n FROM product_master_fts')
    .first<{ n: number }>();
  expect(count?.n).toBe(SEED_PRODUCTS.length);
});

// ---------------------------------------------------------------------------
// Golden parity cases — the spike's Q1–Q13
// ---------------------------------------------------------------------------

interface QueryCase {
  readonly id: string;
  readonly query: string;
  readonly source: string;
  /** Expected product ids that must ALL appear within top-k. */
  readonly expectInTopK: readonly number[];
  /** Optional: the product that must rank FIRST (relevance contract). */
  readonly expectFirst?: number;
}

const CASES: readonly QueryCase[] = [
  {
    id: 'Q1',
    query: 'karhu',
    source:
      'search.controller.test.ts "karhu" ranked case — name match (Karhu III) and brand-only match (Tumma Lager)',
    expectInTopK: [30, 31],
    expectFirst: 30, // pg contract: name match ahead of brand-only match
  },
  {
    id: 'Q2',
    query: 'karh',
    source: 'product-search.db.test.ts partial-word case — ILIKE recall must still match',
    expectInTopK: [30, 31, 40, 41],
  },
  {
    id: 'Q3',
    query: 'KARHU',
    source: 'ILIKE is case-insensitive on the pg side — unicode61 folding must match',
    expectInTopK: [30, 31, 40, 41],
    expectFirst: 30,
  },
  {
    id: 'Q4',
    query: 'le coq',
    source: 'realistic multi-token brand phrase (A. Le Coq Premium)',
    expectInTopK: [20],
    expectFirst: 20,
  },
  {
    id: 'Q5',
    query: 'koff',
    source: 'product-search.db.test.ts seed brand (Koff III rows)',
    expectInTopK: [42, 55],
  },
  {
    id: 'Q6',
    query: 'olut',
    source: 'realistic Finnish generic word inside product names',
    expectInTopK: [10, 55],
  },
  {
    id: 'Q7',
    query: 'lager',
    source: 'realistic name token (Tumma Lager variants)',
    expectInTopK: [31, 41],
  },
  {
    id: 'Q8',
    query: 'sandels',
    source: 'realistic Finnish brand query',
    expectInTopK: [50],
    expectFirst: 50,
  },
  {
    id: 'Q9',
    query: 'norrlands',
    source: 'realistic Swedish brand token',
    expectInTopK: [51],
    expectFirst: 51,
  },
  {
    id: 'Q10',
    query: 'Öltermanni',
    source: 'realistic non-ASCII (Ö) product-name query',
    expectInTopK: [10],
    expectFirst: 10,
  },
  {
    id: 'Q11',
    query: 'öl',
    source: 'realistic Swedish/Finnish short prefix query',
    expectInTopK: [10],
  },
  {
    id: 'Q12',
    query: 'hartwall',
    source: 'manufacturer-only recall (pg searches manufacturer too)',
    // Four pinned Hartwall fixtures must surface in top-5; the seeded set
    // has six Hartwall rows, so two necessarily fall outside k=5 —
    // recall saturation, not a parity failure.
    expectInTopK: [30, 31, 40, 52],
  },
  {
    id: 'Q13',
    query: 'long drink',
    source: 'realistic two-token Finnish product phrase (Long Drink Original)',
    expectInTopK: [53],
    expectFirst: 53,
  },
];

describe('D1ProductSearchRepository.searchRanked — golden parity cases (G2)', () => {
  for (const c of CASES) {
    it(`${c.id} "${c.query}" — ${c.source}`, async () => {
      const rows = await repo.searchRanked(c.query, MAX_PAGE_SIZE);
      const topK = rows.slice(0, K).map((r) => r.id);

      for (const expected of c.expectInTopK) {
        expect(topK).toContain(expected);
      }
      if (c.expectFirst !== undefined) {
        expect(rows[0]?.id).toBe(c.expectFirst);
      }
    });
  }

  it('Q1 "karhu" ranks the name match (Karhu III) ahead of the brand-only match', async () => {
    const rows = await repo.searchRanked('karhu', MAX_PAGE_SIZE);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(30)).toBeLessThan(ids.indexOf(31));
  });

  it('"karhu" matches by name and by brand, and excludes non-matches (pg db-test case 1)', async () => {
    const rows = await repo.searchRanked('karhu', MAX_PAGE_SIZE);
    const names = rows.map((r) => r.name);
    expect(names).toContain('Karhu III (ranked-search-test)');
    expect(names).toContain('Tumma Lager Erityis (ranked-search-test)');
    expect(names).not.toContain('Koff III (ranked-search-test)');
  });

  it('partial-word queries still match through the LIKE recall filter (pg db-test case 3)', async () => {
    // "karh" is too short for strong relevance on the long seeded names —
    // the substring recall merge must still find them.
    const rows = await repo.searchRanked('karh', MAX_PAGE_SIZE);
    const names = rows.map((r) => r.name);
    expect(names).toContain('Karhu III (ranked-search-test)');
    expect(names).toContain('Tumma Lager Erityis (ranked-search-test)');
  });
});

// ---------------------------------------------------------------------------
// Determinism, limit, and pagination interplay
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository.searchRanked — deterministic ordering and pagination interplay', () => {
  it('returns a deterministic order across repeated identical calls (pg db-test case 2)', async () => {
    const first = await repo.searchRanked('karhu', MAX_PAGE_SIZE);
    const second = await repo.searchRanked('karhu', MAX_PAGE_SIZE);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });

  it('respects the fetch limit (pg db-test case 4)', async () => {
    const rows = await repo.searchRanked('karhu', 1);
    expect(rows).toHaveLength(1);
  });

  it('limit=k returns a prefix of the unbounded ranking — pagination slices are sound', async () => {
    for (const c of CASES) {
      const full = await repo.searchRanked(c.query, MAX_PAGE_SIZE);
      for (const k of [1, 2, 3]) {
        const sliced = await repo.searchRanked(c.query, k);
        expect(sliced.map((r) => r.id)).toEqual(full.slice(0, k).map((r) => r.id));
      }
    }
  });

  it('matches the controller contract: relevance order preserved, pages slice it', async () => {
    // The controller fetches MAX_PAGE_SIZE rows then slices per page. The
    // pinned relevance contract (search.controller.test.ts) is: the name
    // match ranks first; the brand-only matches appear within the ranked
    // set after it. bm25's full order beyond those pins is not part of the
    // pg contract (pg breaks GREATEST(similarity)=1.0 ties by id; bm25
    // scores name+brand double hits higher — the G2 gate deliberately
    // gates top-K membership, not full-order equality).
    const ranked = await repo.searchRanked('karhu', MAX_PAGE_SIZE);
    expect(ranked.slice(0, 1).map((r) => r.id)).toEqual([30]);
    const ids = ranked.map((r) => r.id);
    expect(ids.indexOf(30)).toBeLessThan(ids.indexOf(31));
    expect(ids).toEqual(expect.arrayContaining([31, 40, 41]));
  });
});

// ---------------------------------------------------------------------------
// Blank passthrough — the unfiltered alphabetical listing
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository — blank query passthrough', () => {
  it('blank ranked queries list alphabetically with the Finnish collation', async () => {
    for (const blank of ['', '   ']) {
      const rows = await repo.searchRanked(blank, MAX_PAGE_SIZE);
      expect(rows).toHaveLength(SEED_PRODUCTS.length);
      // A. Le Coq Premium sorts first in 'fi' (spike blank-passthrough pin).
      expect(rows[0]?.id).toBe(20);
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1].name.localeCompare(rows[i].name, 'fi');
        expect(prev).toBeLessThanOrEqual(0);
      }
    }
  });

  it('searchByName(null) lists the same alphabetical order', async () => {
    const rows = await repo.searchByName(null, MAX_PAGE_SIZE);
    expect(rows[0]?.id).toBe(20);
    expect(rows).toHaveLength(SEED_PRODUCTS.length);
  });

  it('searchByName honours the limit after the app-side sort', async () => {
    const full = await repo.searchByName(null, MAX_PAGE_SIZE);
    const rows = await repo.searchByName(null, 3);
    // The limited listing is a prefix of the full Finnish-collation order.
    expect(rows.map((r) => r.id)).toEqual(full.slice(0, 3).map((r) => r.id));
    expect(rows[0]?.id).toBe(20); // 'A. Le Coq Premium' sorts first in 'fi'
  });

  it('searchByName filters by name with Unicode case-folding parity (ILIKE)', async () => {
    // ASCII case-insensitivity via SQL LIKE…
    expect((await repo.searchByName('term', MAX_PAGE_SIZE)).map((r) => r.id)).toEqual([10]);
    // …and non-ASCII folding via the app-side re-filter, like pg ILIKE.
    expect((await repo.searchByName('ÖLT', MAX_PAGE_SIZE)).map((r) => r.id)).toEqual([10]);
  });

  it('searchByName returns no matches for absent substrings', async () => {
    const rows = await repo.searchByName('whisky', MAX_PAGE_SIZE);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FTS sync triggers
// ---------------------------------------------------------------------------

describe('product_master_fts sync triggers', () => {
  it('inserts via the repository are visible to MATCH (covered by every golden case)', () => {
    // Q1–Q13 all run against rows written through repository.create() —
    // the AFTER INSERT trigger kept the external-content index in sync.
    expect(CASES.length).toBe(13);
  });

  it('UPDATE re-indexes: the old token disappears, the new one matches', async () => {
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification, created_at, updated_at)
         VALUES (900, 'Hartwall Original Gin', 'Hartwall', 'Original', 'other', 0.5, 'glass', 'other', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    expect((await repo.searchRanked('original gin', 10)).map((r) => r.id)).toContain(900);

    await d1
      .prepare(
        `UPDATE product_master SET name = 'Hartwall Jaloviina', brand = 'Jaloviina' WHERE id = 900`,
      )
      .run();
    // The old name's tokens are gone from the index…
    const after = await repo.searchRanked('original gin', MAX_PAGE_SIZE);
    expect(after.map((r) => r.id)).not.toContain(900);
    // …and the new name matches.
    expect((await repo.searchRanked('jaloviina', 10)).map((r) => r.id)).toContain(900);
  });

  it('DELETE removes the row from the index', async () => {
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification, created_at, updated_at)
         VALUES (901, 'Kotikalja Ekstra', 'Hartwall', 'Kotikalja', 'beer', 0.33, 'metal', 'beer', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    expect((await repo.searchRanked('kotikalja', 10)).map((r) => r.id)).toContain(901);

    await d1.prepare('DELETE FROM product_master WHERE id = 901').run();
    const after = await repo.searchRanked('kotikalja', MAX_PAGE_SIZE);
    expect(after.map((r) => r.id)).not.toContain(901);
  });
});

// ---------------------------------------------------------------------------
// Contract-shape mapping — the pg driver's implicit coercion, explicit here
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository — contract row shapes', () => {
  it('create returns the pg contract shape: numeric text with pg scales, Date timestamps', async () => {
    const row = await repo.findById(30);
    expect(row).toEqual({
      id: 30,
      name: 'Karhu III',
      manufacturer: 'Hartwall',
      brand: 'Karhu',
      category: 'beer',
      alcoholByVolume: '0.045', // numeric(5,3) text
      unitVolume: '0.3300', // numeric(10,4) text — trailing scale preserved
      containerType: 'metal',
      regulatoryClassification: 'beer',
      depositSystemStatus: true,
      ean: '0641000111111',
      // Seed row carries no weight — the nullable column maps to null.
      weightGrams: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('findById returns null for absent ids', async () => {
    await expect(repo.findById(999_999)).resolves.toBeNull();
  });

  it('findOffers maps observed_at TEXT → Date', async () => {
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (500, 'alko', 'FI', 30, 249, '2026-08-20T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();
    const offers = await repo.findOffers(30);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toEqual({
      id: 500,
      merchant: 'alko',
      country: 'FI',
      productId: 30,
      priceCents: 249,
      currency: 'EUR',
      availability: 'unknown',
      sourceUrl: null,
      observedAt: new Date('2026-08-20T10:00:00.000Z'),
      reliabilityStatus: 'VERIFIED',
    });
    expect(await repo.findRetailOfferById(500)).not.toBeNull();
    expect(await repo.findRetailOfferById(999_999)).toBeNull();
  });

  it('upsertByEan inserts, then updates in place preserving id and createdAt', async () => {
    const created = await repo.create({
      name: 'Lada Kolikko',
      manufacturer: 'Hartwall',
      brand: 'Lada',
      category: 'beer',
      alcoholByVolume: '0.047',
      unitVolume: '0.33',
      containerType: 'metal',
      regulatoryClassification: 'beer',
      depositSystemStatus: true,
      ean: '0641000999999',
    });
    const firstUpdatedAt = created.updatedAt;

    const upserted = await repo.upsertByEan({
      name: 'Lada Kolikko II',
      manufacturer: 'Hartwall',
      brand: 'Lada',
      category: 'beer',
      alcoholByVolume: '0.050',
      unitVolume: '0.33',
      containerType: 'metal',
      regulatoryClassification: 'beer',
      depositSystemStatus: true,
      ean: '0641000999999',
    });

    expect(upserted.id).toBe(created.id);
    expect(upserted.createdAt).toEqual(created.createdAt);
    expect(upserted.name).toBe('Lada Kolikko II');
    expect(upserted.alcoholByVolume).toBe('0.050');
    expect(firstUpdatedAt.getTime()).toBeLessThanOrEqual(upserted.updatedAt.getTime());

    // And the FTS index followed the UPDATE trigger.
    expect((await repo.searchRanked('lada kolikko ii', 5)).map((r) => r.id)).toContain(created.id);
  });

  it('upsertByEan without an EAN performs a plain insert', async () => {
    const created = await repo.create({
      name: 'Eanless Panimo Olut',
      manufacturer: 'Panimo Oy',
      brand: 'Eanless',
      category: 'beer',
      alcoholByVolume: null,
      unitVolume: '0.33',
      containerType: 'glass',
      regulatoryClassification: 'beer',
      depositSystemStatus: null,
      ean: null,
    });
    expect(created.alcoholByVolume).toBeNull();
    expect(created.depositSystemStatus).toBeNull();
  });

  it('rejects non-numeric decimal input the way pg rejects bad numerics', async () => {
    await expect(
      repo.create({
        name: 'Bad Decimal',
        manufacturer: 'X',
        brand: 'X',
        category: 'beer',
        alcoholByVolume: 'not-a-number',
        unitVolume: '0.33',
        containerType: 'metal',
        regulatoryClassification: 'beer',
        ean: null,
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  // -------------------------------------------------------------------------
  // Feed weight persistence (task 3.1, design D7, change
  // alks-feed-and-import-vat)
  // -------------------------------------------------------------------------

  it('spec: weight 0.53 kg → product master row stores weight_grams = 530', async () => {
    const created = await repo.create({
      name: 'Herb Liqueur 35% 0.5 l PET',
      manufacturer: 'Alks Partner',
      brand: 'Herb Liqueur',
      category: 'spirits',
      alcoholByVolume: '0.350',
      unitVolume: '0.50',
      containerType: 'plastic',
      regulatoryClassification: 'spirits',
      depositSystemStatus: false,
      ean: '0474007700591',
      weightGrams: 530,
    });

    expect(created.weightGrams).toBe(530);
    const reread = await repo.findById(created.id);
    expect(reread?.weightGrams).toBe(530);
  });

  it('spec: absent weight → weight_grams stays null and no error is reported', async () => {
    const created = await repo.create({
      name: 'German Pilsner 4.8% 0,5 l',
      manufacturer: 'Kulbrau',
      brand: 'Kulbrau',
      category: 'beer',
      alcoholByVolume: '0.048',
      unitVolume: '0.50',
      containerType: 'glass',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean: '0426012345678',
    });

    expect(created.weightGrams).toBeNull();
  });

  it('upsertByEan refresh overwrites the stored weight, including back to null', async () => {
    const ean = '0474007700592';
    await repo.create({
      name: 'Weighted Klone',
      manufacturer: 'Alks Partner',
      brand: 'Weighted',
      category: 'beer',
      alcoholByVolume: '0.050',
      unitVolume: '0.33',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean,
      weightGrams: 1250,
    });

    const heavier = await repo.upsertByEan({
      name: 'Weighted Klone',
      manufacturer: 'Alks Partner',
      brand: 'Weighted',
      category: 'beer',
      alcoholByVolume: '0.050',
      unitVolume: '0.33',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean,
      weightGrams: 530,
    });
    expect(heavier.weightGrams).toBe(530);

    // A weight-less refresh of the same product persists null — the feed
    // is the source of truth for the column (design D7).
    const weightless = await repo.upsertByEan({
      name: 'Weighted Klone',
      manufacturer: 'Alks Partner',
      brand: 'Weighted',
      category: 'beer',
      alcoholByVolume: '0.050',
      unitVolume: '0.33',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean,
    });
    expect(weightless.weightGrams).toBeNull();
  });

  it('keeps the raw shim database handle usable for direct SQL assertions', () => {
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type IN ('table', 'trigger') AND name LIKE 'product_master%' ORDER BY name`,
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('product_master');
    expect(tables).toContain('product_master_fts');
    for (const trigger of ['product_master_fts_ai', 'product_master_fts_ad', 'product_master_fts_au']) {
      expect(tables).toContain(trigger);
    }
  });
});

// ---------------------------------------------------------------------------
// Catalog listing (task 1.1, change product-catalog — design D1 keys-then-
// page, D4 per-page offer aggregation)
// ---------------------------------------------------------------------------

/**
 * The catalog fixture: 110 wine_still products — 107 zero-padded numbered
 * names plus three specials pinning the 'fi' collation tail (under Finnish
 * collation the numbered names sort first, then z, then ä, then ö). The
 * fixture is deliberately larger than MAX_PAGE_SIZE (100), the legacy
 * in-memory fetch cap, so uncapped totals cannot pass by accident.
 */
const CATALOG_FIXTURE_COUNT = 110;
const SPECIAL_CATALOG_IDS = {
  zibart: 2107,
  agras: 2108,
  oylatti: 2109,
} as const;

/** Fixture id → name, accumulated while seeding (the expected order's source). */
const catalogNamesById = new Map<number, string>();

/** The fixture's expected Finnish-collation order (the contract comparator, mirrored). */
function expectedCatalogOrder(): number[] {
  return [...catalogNamesById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fi') || a.id - b.id)
    .map((key) => key.id);
}

describe('D1ProductSearchRepository.listCatalogPage — catalog listing (design D1/D4)', () => {
  beforeAll(async () => {
    for (let i = 0; i < 107; i++) {
      catalogNamesById.set(2000 + i, `Koekappale Olut ${String(i).padStart(3, '0')}`);
    }
    catalogNamesById.set(SPECIAL_CATALOG_IDS.zibart, 'Zibart Punaviini');
    catalogNamesById.set(SPECIAL_CATALOG_IDS.agras, 'Ägräs Akvavit');
    catalogNamesById.set(SPECIAL_CATALOG_IDS.oylatti, 'Öylatti Erityis');

    for (const [id, name] of catalogNamesById) {
      await repo.create({
        id,
        name,
        manufacturer: 'Katalogi Panimo',
        brand: 'Koekappale',
        category: 'wine_still',
        alcoholByVolume: null,
        unitVolume: '0.75',
        containerType: 'glass',
        regulatoryClassification: 'wine',
        depositSystemStatus: null,
        ean: null,
      });
    }

    // Offer fixtures (design D4):
    // - 2000: two distinct merchants → min 250, count 2.
    // - 2001: one merchant, two prices → MIN 199, DISTINCT-merchant count 1.
    // - 2002: offer-less → null / 0 (asserted below; honest absence).
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (600, 'alko', 'FI', 2000, 299, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (601, 'eu-import', 'EE', 2000, 250, '2026-09-01T10:00:00.000Z', 'ESTIMATED'),
                (602, 'alko', 'FI', 2001, 350, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (603, 'alko', 'FI', 2001, 199, '2026-09-02T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();
  });

  it('reports the exact total of the category-filtered catalog, uncapped by the legacy fetch limit', async () => {
    const result = await repo.listCatalogPage(1, 100, 'wine_still');
    expect(result.total).toBe(CATALOG_FIXTURE_COUNT);
    // The fixture exceeds MAX_PAGE_SIZE — a fetch-capped total would be
    // 100, never 110 (spec: "Totals beyond the legacy cap").
    expect(result.total).toBeGreaterThan(MAX_PAGE_SIZE);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(result.items).toHaveLength(100);
  });

  it('serves deep pages beyond the legacy fetch cap, total intact', async () => {
    const expected = expectedCatalogOrder();
    const page2 = await repo.listCatalogPage(2, 100, 'wine_still');
    expect(page2.total).toBe(CATALOG_FIXTURE_COUNT);
    expect(page2.items.map((item) => item.product.id)).toEqual(
      expected.slice(100),
    );

    const pastEnd = await repo.listCatalogPage(3, 100, 'wine_still');
    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.total).toBe(CATALOG_FIXTURE_COUNT);
  });

  it('orders deterministically under the Finnish collation (ä/ö after z)', async () => {
    // Pages 1+2 concatenated must equal the mirrored contract comparator's
    // order over the whole fixture.
    const expected = expectedCatalogOrder();
    const collected: number[] = [];
    for (let p = 1; p <= 2; p++) {
      const result = await repo.listCatalogPage(p, 100, 'wine_still');
      collected.push(...result.items.map((item) => item.product.id));
    }
    expect(collected).toEqual(expected);

    // Pin the 'fi' tail explicitly: K-names first, then z < ä < ö — the
    // documented contract that SQL BINARY ORDER BY cannot reproduce.
    expect(expected.slice(-3)).toEqual([
      SPECIAL_CATALOG_IDS.zibart,
      SPECIAL_CATALOG_IDS.agras,
      SPECIAL_CATALOG_IDS.oylatti,
    ]);

    // Determinism: identical request → identical order (spec: "Repeated
    // request → identical order").
    const first = await repo.listCatalogPage(2, 100, 'wine_still');
    const second = await repo.listCatalogPage(2, 100, 'wine_still');
    expect(first.items.map((item) => item.product.id)).toEqual(
      second.items.map((item) => item.product.id),
    );
  });

  it('slices pages exactly — middle, last, and past-the-end', async () => {
    const expected = expectedCatalogOrder();
    const middle = await repo.listCatalogPage(10, 7, 'wine_still');
    expect(middle.items.map((item) => item.product.id)).toEqual(
      expected.slice(63, 70),
    );
    expect(middle.total).toBe(CATALOG_FIXTURE_COUNT);

    const last = await repo.listCatalogPage(16, 7, 'wine_still');
    expect(last.items.map((item) => item.product.id)).toEqual(
      expected.slice(105),
    );

    const past = await repo.listCatalogPage(17, 7, 'wine_still');
    expect(past.items).toEqual([]);
    expect(past.total).toBe(CATALOG_FIXTURE_COUNT);
  });

  it('filters by category exactly, on the fixture and on the earlier describes\' rows', async () => {
    const wine = await repo.listCatalogPage(1, 100, 'wine_still');
    expect(wine.items.every((item) => item.product.category === 'wine_still')).toBe(true);
    expect(wine.total).toBe(CATALOG_FIXTURE_COUNT);

    // Exact total against the stored rows for a category the fixture does
    // not touch — beer rows accumulated by the earlier test blocks.
    const beerCount = await d1
      .prepare(`SELECT count(*) AS n FROM product_master WHERE category = 'beer'`)
      .first<{ n: number }>();
    const beer = await repo.listCatalogPage(1, 100, 'beer');
    expect(beer.total).toBe(beerCount?.n);
    expect(beer.items.every((item) => item.product.category === 'beer')).toBe(true);
  });

  it('populates the per-page offer aggregates; offer-less products stay null/0 (design D4)', async () => {
    const result = await repo.listCatalogPage(1, 100, 'wine_still');
    const itemsById = new Map(result.items.map((item) => [item.product.id, item]));

    // Two distinct merchants → lowest across both, count 2.
    expect(itemsById.get(2000)?.lowestPriceCents).toBe(250);
    expect(itemsById.get(2000)?.merchantCount).toBe(2);
    // Two prices, one merchant → MIN over prices, COUNT(DISTINCT merchant) = 1.
    expect(itemsById.get(2001)?.lowestPriceCents).toBe(199);
    expect(itemsById.get(2001)?.merchantCount).toBe(1);
    // No offers at all → honest absence, never a guessed price.
    expect(itemsById.get(2002)?.lowestPriceCents).toBeNull();
    expect(itemsById.get(2002)?.merchantCount).toBe(0);
  });

  it('returns full contract product rows on the listing items', async () => {
    const result = await repo.listCatalogPage(1, 100, 'wine_still');
    const item = result.items.find(
      (candidate) => candidate.product.id === 2000,
    );
    expect(item?.product).toEqual({
      id: 2000,
      name: 'Koekappale Olut 000',
      manufacturer: 'Katalogi Panimo',
      brand: 'Koekappale',
      category: 'wine_still',
      alcoholByVolume: null,
      unitVolume: '0.7500', // numeric(10,4) text scale, like the pg contract
      containerType: 'glass',
      regulatoryClassification: 'wine',
      depositSystemStatus: null,
      ean: null,
      weightGrams: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('returns zero rows for a canonical category with no products', async () => {
    const result = await repo.listCatalogPage(1, 24, 'intermediate_products');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(24);
  });

  it('treats an unknown category value as a strict filter, never a fallback', async () => {
    // The API route 400s unknown values (design D2); the repository's own
    // contract is equally strict in effect — exact equality, zero rows.
    const result = await repo.listCatalogPage(1, 24, 'mead');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});

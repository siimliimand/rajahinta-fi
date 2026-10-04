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
import {
  D1ProductSearchRepository,
  FINNISH_SYNONYM_GROUPS,
  MAX_MATCH_PHRASES,
  SEARCH_PAGE_SIZE,
  SUGGESTION_MAX_EDIT_DISTANCE,
  boundedEditDistance,
  buildMatchExpression,
  foldComparisonKey,
  tokenize,
} from '../product-search.repository';

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

  it('findOffers maps observed_at TEXT → Date and carries the registry carrier (task 3.3)', async () => {
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
      // No merchant_registry row for 'alko' in this fixture — the honest
      // unknown, never a guessed carrier.
      carrierId: null,
    });
    expect(await repo.findRetailOfferById(500)).not.toBeNull();
    expect(await repo.findRetailOfferById(999_999)).toBeNull();
  });

  it('findOffers joins merchant_registry.carrier_id per merchant, LEFT so unregistered merchants survive (task 3.3, design D1)', async () => {
    // Dedicated product — no other test asserts on this id's offer set.
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification)
         VALUES (990, 'Carrier Join Fixture', 'm', 'b', 'beer', 0.33, 'can', 'beer')`,
      )
      .run();
    // 'fransberg-de' registered with an assignment, 'unassigned-de'
    // registered with a NULL assignment, 'ghost-de' not in the registry at
    // all — all three offers must come back, each with its honest carrier.
    await d1
      .prepare(
        `INSERT INTO merchant_registry (id, merchant_id, name, country, feed_url, feed_format, polling_interval_ms, carrier_id)
         VALUES (9001, 'fransberg-de', 'Fransberg DE', 'DE', '', 'json', 3600000, 'fransberg'),
                (9002, 'unassigned-de', 'Unassigned DE', 'DE', '', 'json', 3600000, NULL)`,
      )
      .run();
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (540, 'fransberg-de', 'DE', 990, 300, '2026-09-03T10:00:00.000Z', 'VERIFIED'),
                (541, 'unassigned-de', 'DE', 990, 310, '2026-09-03T10:00:00.000Z', 'VERIFIED'),
                (542, 'ghost-de', 'DE', 990, 320, '2026-09-03T10:00:00.000Z', 'ESTIMATED')`,
      )
      .run();

    const offers = await repo.findOffers(990);
    expect(
      Object.fromEntries(offers.map((o) => [o.merchant, o.carrierId])),
    ).toEqual({
      'fransberg-de': 'fransberg',
      'unassigned-de': null,
      // LEFT JOIN: a merchant missing from the registry reads as null,
      // never drops the offer.
      'ghost-de': null,
    });

    // The suite shares one migrated database — remove every fixture row so
    // later tests see exactly the state they seeded.
    await d1.prepare(`DELETE FROM retail_offers WHERE id IN (540, 541, 542)`).run();
    await d1.prepare(`DELETE FROM merchant_registry WHERE id IN (9001, 9002)`).run();
    await d1.prepare(`DELETE FROM product_master WHERE id = 990`).run();
  });

  // -------------------------------------------------------------------------
  // findOffers — latest row per (product, merchant) (task 4.1, change
  // 2026-09-13-daily-scrape-cadence-current-offers). The table is
  // append-per-scrape, so findOffers must collapse the scrape history to one
  // row per merchant: the max id, matching the (observed_at, id) recency
  // upsertOffer change detection uses.
  // -------------------------------------------------------------------------

  it('findOffers returns a single row per merchant on duplicate scrapes — the later id', async () => {
    // Two scrape runs, same (product 31, merchant alko), same price.
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (510, 'alko', 'FI', 31, 249, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (511, 'alko', 'FI', 31, 249, '2026-09-02T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();

    const offers = await repo.findOffers(31);
    expect(offers.map((o) => o.id)).toEqual([511]);
  });

  it('findOffers supersedes the older row when the price moves', async () => {
    // Price moved 17.99 → 19.99 between scrapes; only the current price row.
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (520, 'alko', 'FI', 40, 1799, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (521, 'alko', 'FI', 40, 1999, '2026-09-02T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();

    const offers = await repo.findOffers(40);
    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe(521);
    expect(offers[0].priceCents).toBe(1999);
  });

  it('findOffers returns one latest row for each of two merchants on one product', async () => {
    // alko scraped twice (latest 531), eu-import once (532) — one row per
    // merchant, alko's being its latest scrape.
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (530, 'alko', 'FI', 41, 250, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (531, 'alko', 'FI', 41, 299, '2026-09-02T10:00:00.000Z', 'VERIFIED'),
                (532, 'eu-import', 'EE', 41, 350, '2026-09-02T10:00:00.000Z', 'ESTIMATED')`,
      )
      .run();

    const offers = await repo.findOffers(41);
    expect(offers.map((o) => o.id)).toEqual([531, 532]); // deterministic o.id ASC
    expect(
      Object.fromEntries(offers.map((o) => [o.merchant, o.priceCents])),
    ).toEqual({ alko: 299, 'eu-import': 350 });
  });

  it('findOffers does not leak other products\' offers', async () => {
    // Products 31/40/41 carry scrape history at this point; product 42 has
    // none and must stay empty.
    const offers = await repo.findOffers(42);
    expect(offers).toEqual([]);
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
    // Explicit ALPHABETICAL: this block pins the FI-collation contract,
    // which is no longer the listing default (task 1.3, change
    // first-impression-pass flipped the default to LOWEST_PRICE).
    const page2 = await repo.listCatalogPage(2, 100, 'wine_still', 'ALPHABETICAL');
    expect(page2.total).toBe(CATALOG_FIXTURE_COUNT);
    expect(page2.items.map((item) => item.product.id)).toEqual(
      expected.slice(100),
    );

    const pastEnd = await repo.listCatalogPage(3, 100, 'wine_still', 'ALPHABETICAL');
    expect(pastEnd.items).toEqual([]);
    expect(pastEnd.total).toBe(CATALOG_FIXTURE_COUNT);
  });

  it('orders deterministically under the Finnish collation (ä/ö after z)', async () => {
    // Pages 1+2 concatenated must equal the mirrored contract comparator's
    // order over the whole fixture (explicit ALPHABETICAL — see above).
    const expected = expectedCatalogOrder();
    const collected: number[] = [];
    for (let p = 1; p <= 2; p++) {
      const result = await repo.listCatalogPage(p, 100, 'wine_still', 'ALPHABETICAL');
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
    const first = await repo.listCatalogPage(2, 100, 'wine_still', 'ALPHABETICAL');
    const second = await repo.listCatalogPage(2, 100, 'wine_still', 'ALPHABETICAL');
    expect(first.items.map((item) => item.product.id)).toEqual(
      second.items.map((item) => item.product.id),
    );
  });

  it('slices pages exactly — middle, last, and past-the-end', async () => {
    const expected = expectedCatalogOrder();
    const middle = await repo.listCatalogPage(10, 7, 'wine_still', 'ALPHABETICAL');
    expect(middle.items.map((item) => item.product.id)).toEqual(
      expected.slice(63, 70),
    );
    expect(middle.total).toBe(CATALOG_FIXTURE_COUNT);

    const last = await repo.listCatalogPage(16, 7, 'wine_still', 'ALPHABETICAL');
    expect(last.items.map((item) => item.product.id)).toEqual(
      expected.slice(105),
    );

    const past = await repo.listCatalogPage(17, 7, 'wine_still', 'ALPHABETICAL');
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

// ---------------------------------------------------------------------------
// Cheapest current offer provenance (task 2.2, change
// honest-trust-surfaces) — the listing €/g embed derives from ONE
// specific offer: the cheapest row of the latest-observation set, with
// that row's own reliability status. The set and its semantics are
// findOffers' (detail-route parity), so the tests pin the aggregate
// against findOffers directly.
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository.listCatalogPage — cheapest current offer provenance (task 2.2)', () => {
  const provDb = openMigratedD1();
  const provRepo = new D1ProductSearchRepository(provDb.d1);

  beforeAll(async () => {
    // 5101: the SUPERSEDED scrape is cheaper AND VERIFIED — neither its
    // price nor its status may leak; the current row is pricier and
    // ESTIMATED. 5102: a STALE-labeled current row surfaces its own
    // provenance (the detail page lists the same row). 5103: two
    // merchants tie at the minimum — the lowest offer id wins.
    for (const r of [
      { id: 5101, name: 'Provenanssi A' },
      { id: 5102, name: 'Provenanssi B' },
      { id: 5103, name: 'Provenanssi C' },
    ]) {
      await provRepo.create({
        id: r.id,
        name: r.name,
        manufacturer: 'Provenanssi Panimo',
        brand: 'Provenanssi',
        category: 'spirits',
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: 'spirits',
        depositSystemStatus: true,
        ean: null,
      });
    }
    await provDb.d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (700, 'alko', 'FI', 5101, 100, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (701, 'alko', 'FI', 5101, 200, '2026-09-02T10:00:00.000Z', 'ESTIMATED'),
                (710, 'alko', 'FI', 5102, 300, '2026-09-02T10:00:00.000Z', 'STALE'),
                (720, 'alko', 'FI', 5103, 400, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (721, 'eu-import', 'EE', 5103, 400, '2026-09-01T10:00:00.000Z', 'ESTIMATED')`,
      )
      .run();
  });

  it('exposes the cheapest current offer’s price AND its provenance', async () => {
    const result = await repo.listCatalogPage(1, 100, 'wine_still');
    const byId = new Map(result.items.map((item) => [item.product.id, item]));
    // 2000: the min 250 belongs to the ESTIMATED eu-import row (601) —
    // not the VERIFIED co-offer's status.
    expect(byId.get(2000)?.lowestPriceCents).toBe(250);
    expect(byId.get(2000)?.cheapestOfferReliabilityStatus).toBe('ESTIMATED');
    // 2001: the latest scrape (603) holds the min 199, VERIFIED.
    expect(byId.get(2001)?.lowestPriceCents).toBe(199);
    expect(byId.get(2001)?.cheapestOfferReliabilityStatus).toBe('VERIFIED');
  });

  it('a superseded cheaper scrape leaks neither its price nor its status', async () => {
    const result = await provRepo.listCatalogPage(1, 10, 'spirits');
    const a = result.items.find((item) => item.product.id === 5101);
    // The current row is 200/ESTIMATED — the superseded 100/VERIFIED
    // scrape prices and labels nothing.
    expect(a?.lowestPriceCents).toBe(200);
    expect(a?.cheapestOfferReliabilityStatus).toBe('ESTIMATED');
  });

  it('a product with no current offer exposes neither price nor provenance (honest absence)', async () => {
    // Shared fixture 2002 has no retail_offers rows at all.
    const wine = await repo.listCatalogPage(1, 100, 'wine_still');
    const offerless = wine.items.find((item) => item.product.id === 2002);
    expect(offerless?.lowestPriceCents).toBeNull();
    expect(offerless?.merchantCount).toBe(0);
    expect(offerless?.cheapestOfferReliabilityStatus).toBeNull();

    // A STALE-LABELED row is still a current row: it surfaces with its
    // own status, exactly as the detail page lists it — the label is
    // honest, the price is never presented as VERIFIED.
    const spirits = await provRepo.listCatalogPage(1, 10, 'spirits');
    const stale = spirits.items.find((item) => item.product.id === 5102);
    expect(stale?.lowestPriceCents).toBe(300);
    expect(stale?.cheapestOfferReliabilityStatus).toBe('STALE');
  });

  it('a price tie resolves to the lowest offer id — the detail route’s own pick', async () => {
    const result = await provRepo.listCatalogPage(1, 10, 'spirits');
    const tied = result.items.find((item) => item.product.id === 5103);
    expect(tied?.lowestPriceCents).toBe(400);
    // findOrders parity: findOffers lists [720, 721] id-ASC; the shared
    // lowest-current-offer rule keeps 720 (strictly-smaller only), so
    // the provenance is 720's VERIFIED, never 721's ESTIMATED.
    expect(tied?.cheapestOfferReliabilityStatus).toBe('VERIFIED');
    const offers = await provRepo.findOffers(5103);
    expect(offers.map((o) => o.id)).toEqual([720, 721]);
    const best = offers.reduce((acc, o) => (o.priceCents < acc.priceCents ? o : acc));
    expect(best.id).toBe(720);
    expect(best.reliabilityStatus).toBe('VERIFIED');
  });

  it('the aggregate provenance equals what findOffers implies for every offered product', async () => {
    const result = await repo.listCatalogPage(1, 100, 'wine_still');
    for (const item of result.items) {
      if (item.lowestPriceCents === null) continue;
      const offers = await repo.findOffers(item.product.id);
      expect(offers.length).toBeGreaterThan(0);
      const best = offers.reduce((acc, o) =>
        o.priceCents < acc.priceCents ? o : acc,
      );
      expect(item.lowestPriceCents).toBe(best.priceCents);
      expect(item.cheapestOfferReliabilityStatus).toBe(best.reliabilityStatus);
    }
  });
});

// ---------------------------------------------------------------------------
// Catalog sort orders (task 1.2, change client-experience-improvement) —
// isolated fixture DB so the shared-database describes above are untouched.
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository.listCatalogPage — objective sort orders (task 1.2)', () => {
  const priceRepoDb = openMigratedD1();
  const priceRepo = new D1ProductSearchRepository(priceRepoDb.d1);

  /**
   * Price fixture: distinct minima (300, 400), a min-price tie (500 —
   * ids 3001/3003, resolved by id ASC), an offer-less product (3005,
   * last), and a superseded cheaper scrape (row 604 → the aggregate
   * reads the LATEST observation per (product, merchant), so 3002's key
   * price is its current scrape 420 — a superseded cheaper scrape must
   * not drag the sort key or the rendered price).
   */
  beforeAll(async () => {
    const wine = [
      { id: 3001, name: 'Koevi A' },
      { id: 3002, name: 'Koevi B' },
      { id: 3003, name: 'Koevi C' },
      { id: 3004, name: 'Koevi D' },
      { id: 3005, name: 'Koevi E' },
    ];
    for (const p of wine) {
      await priceRepo.create({
        id: p.id,
        name: p.name,
        manufacturer: 'Katalogi Panimo',
        brand: 'Koekappale',
        category: 'wine_still',
        alcoholByVolume: '0.120',
        unitVolume: '0.75',
        containerType: 'glass',
        regulatoryClassification: 'wine',
        depositSystemStatus: null,
        ean: null,
      });
    }
    await priceRepoDb.d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (604, 'alko', 'FI', 3002, 400, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (605, 'alko', 'FI', 3002, 420, '2026-09-02T10:00:00.000Z', 'VERIFIED'),
                (606, 'alko', 'FI', 3001, 500, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (607, 'alko', 'FI', 3003, 600, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (608, 'eu-import', 'EE', 3003, 500, '2026-09-01T10:00:00.000Z', 'ESTIMATED'),
                (609, 'alko', 'FI', 3004, 300, '2026-09-01T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();

    // A second category with offers, for the category+sort composition.
    for (const id of [3101, 3102]) {
      await priceRepo.create({
        id,
        name: `Koevi Kalja ${id - 3100}`,
        manufacturer: 'Katalogi Panimo',
        brand: 'Koekappale',
        category: 'beer',
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: 'beer',
        depositSystemStatus: true,
        ean: null,
      });
    }
    await priceRepoDb.d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (610, 'alko', 'FI', 3101, 350, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (611, 'alko', 'FI', 3102, 290, '2026-09-01T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();
  });

  it('LOWEST_PRICE orders ascending, ties by id, offer-less products last', async () => {
    const result = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    expect(result.total).toBe(5);
    expect(result.items.map((i) => i.product.id)).toEqual([
      3004, // min 300
      3002, // min 420 — the LATEST scrape; superseded 400 must not drag
      3001, // min 500 — id tie ahead of 3003
      3003, // min 500
      3005, // no offers — after every priced row, never a guessed position
    ]);
    // The rendered aggregate equals the sort key on every row.
    const mins = result.items.map((i) => i.lowestPriceCents);
    expect(mins).toEqual([300, 420, 500, 500, null]);
  });

  it('LOWEST_PRICE paginates the same total order across pages', async () => {
    const collected: number[] = [];
    for (let p = 1; p <= 3; p++) {
      const result = await priceRepo.listCatalogPage(p, 2, 'wine_still', 'LOWEST_PRICE');
      collected.push(...result.items.map((i) => i.product.id));
      expect(result.total).toBe(5);
    }
    expect(collected).toEqual([3004, 3002, 3001, 3003, 3005]);
  });

  it('LOWEST_PRICE is deterministic across repeat calls and separate compositions', async () => {
    const first = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    const second = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    expect(second.items.map((i) => i.product.id)).toEqual(
      first.items.map((i) => i.product.id),
    );

    const otherDb = openMigratedD1();
    const otherRepo = new D1ProductSearchRepository(otherDb.d1);
    await otherRepo.create({
      id: 3004,
      name: 'Koevi D',
      manufacturer: 'Katalogi Panimo',
      brand: 'Koekappale',
      category: 'wine_still',
      alcoholByVolume: '0.120',
      unitVolume: '0.75',
      containerType: 'glass',
      regulatoryClassification: 'wine',
      depositSystemStatus: null,
      ean: null,
    });
    await otherRepo.create({
      id: 3005,
      name: 'Koevi E',
      manufacturer: 'Katalogi Panimo',
      brand: 'Koekappale',
      category: 'wine_still',
      alcoholByVolume: '0.120',
      unitVolume: '0.75',
      containerType: 'glass',
      regulatoryClassification: 'wine',
      depositSystemStatus: null,
      ean: null,
    });
    const other = await otherRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    expect(other.items.map((i) => i.product.id)).toEqual([3004, 3005]);
  });

  it('a superseded zero-price scrape must not crown the LOWEST_PRICE catalog (2026-10-01 production incident)', async () => {
    // The live incident: a pre-price-floor sweep stored price 0 for a
    // product the feed still advertises; the plausibility gate now
    // rejects new zero observations, so the stale row can never be
    // superseded by a sweep — and the all-rows MIN crowned it at the
    // head of the catalog. The latest-observation aggregate reads the
    // recovered price instead.
    await priceRepo.create({
      id: 3006,
      name: 'Koevi F',
      manufacturer: 'Katalogi Panimo',
      brand: 'Koekappale',
      category: 'wine_still',
      alcoholByVolume: '0.125',
      unitVolume: '0.75',
      containerType: 'glass',
      regulatoryClassification: 'wine',
      depositSystemStatus: null,
      ean: null,
    });
    await priceRepoDb.d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (612, 'alks', 'DE', 3006, 0, '2026-09-14T08:01:32.000Z', 'ESTIMATED'),
                (613, 'alks', 'DE', 3006, 750, '2026-10-01T00:01:09.000Z', 'ESTIMATED')`,
      )
      .run();

    const result = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    const item = result.items.find((candidate) => candidate.product.id === 3006);
    // The recovered price, never the superseded zero.
    expect(item?.lowestPriceCents).toBe(750);
    // Sorts after the 500-minimum rows, before the offer-less product —
    // no zero-price crown anywhere in the order.
    expect(result.items.map((i) => i.product.id)).toEqual([
      3004, 3002, 3001, 3003, 3006, 3005,
    ]);
    // Detail parity: findOffers already collapsed to the same latest row.
    const offers = await priceRepo.findOffers(3006);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.priceCents).toBe(750);
  });

  it('ALCOHOL_PERCENTAGE orders descending, ties by id, unknown ABV last', async () => {
    const abvDb = openMigratedD1();
    const abvRepo = new D1ProductSearchRepository(abvDb.d1);
    const abvs: ReadonlyArray<{ id: number; name: string; abv: string | null }> = [
      { id: 3201, name: 'Koevi Vahva', abv: '0.085' },
      { id: 3202, name: 'Koevi Keski', abv: '0.047' },
      { id: 3203, name: 'Koevi Kevyt', abv: '0.035' },
      { id: 3204, name: 'Koevi Tasu A', abv: '0.053' },
      { id: 3205, name: 'Koevi Tasu B', abv: '0.053' },
      { id: 3206, name: 'Koevi Tuntematon', abv: null },
    ];
    for (const p of abvs) {
      await abvRepo.create({
        id: p.id,
        name: p.name,
        manufacturer: 'Katalogi Panimo',
        brand: 'Koekappale',
        category: 'beer',
        alcoholByVolume: p.abv,
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: 'beer',
        depositSystemStatus: true,
        ean: null,
      });
    }

    const result = await abvRepo.listCatalogPage(1, 24, 'beer', 'ALCOHOL_PERCENTAGE');
    expect(result.items.map((i) => i.product.id)).toEqual([
      3201, // 8.5 %
      3204, // 5.3 % — id tie ahead of 3205
      3205, // 5.3 %
      3202, // 4.7 %
      3203, // 3.5 %
      3206, // unknown ABV — last, honest absence
    ]);
    expect(result.items[result.items.length - 1]!.product.alcoholByVolume).toBeNull();
  });

  it('LOWEST_PRICE composes with the category filter, total exact', async () => {
    const result = await priceRepo.listCatalogPage(1, 24, 'beer', 'LOWEST_PRICE');
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.product.id)).toEqual([3102, 3101]);
  });

  it('the omitted sort defaults to LOWEST_PRICE on the default path — priced ascending, offer-less strictly after priced (task 1.3)', async () => {
    // No category, no sort — the exact shape the route's blank-q browse
    // sends. The priceRepo catalog holds the six wine_still fixtures
    // (3006 added by the incident test above) plus the two beer rows.
    const result = await priceRepo.listCatalogPage(1, 24);
    expect(result.total).toBe(8);
    expect(result.items.map((i) => i.product.id)).toEqual([
      3102, // 290
      3004, // 300
      3101, // 350
      3002, // 420 — the latest scrape
      3001, // 500 — id tie ahead of 3003
      3003, // 500
      3006, // 750 — recovered price
      3005, // no offers — strictly after every priced row
    ]);
    expect(result.items[result.items.length - 1]!.lowestPriceCents).toBeNull();
  });

  it('the omitted sort defaults to LOWEST_PRICE on the category-view path too (task 1.3)', async () => {
    const result = await priceRepo.listCatalogPage(1, 24, 'beer');
    expect(result.total).toBe(2);
    // 290 < 350 — price ascending within the category, not the name order
    // (Koevi Kalja 1 would lead alphabetically).
    expect(result.items.map((i) => i.product.id)).toEqual([3102, 3101]);
  });

  it('the omitted sort equals the explicit LOWEST_PRICE — never the alphabetical order — deterministically across runs (task 1.3)', async () => {
    const omitted = await priceRepo.listCatalogPage(1, 24, 'wine_still');
    const explicit = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'LOWEST_PRICE');
    expect(omitted.items.map((i) => i.product.id)).toEqual(
      explicit.items.map((i) => i.product.id),
    );
    // The FI-collation alphabetical order differs from the price order —
    // proves the default really did flip away from the name sort.
    const alphabetical = await priceRepo.listCatalogPage(1, 24, 'wine_still', 'ALPHABETICAL');
    expect(alphabetical.items.map((i) => i.product.id)).not.toEqual(
      omitted.items.map((i) => i.product.id),
    );
    // Deterministic: identical call → identical order, every run.
    const again = await priceRepo.listCatalogPage(1, 24, 'wine_still');
    expect(again.items.map((i) => i.product.id)).toEqual(
      omitted.items.map((i) => i.product.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Combined category + keyword search (task 2.1, change
// client-experience-improvement) — isolated fixture DB so the shared-
// database describes above are untouched. Spec product-search: when both
// q and category are present the result set contains only keyword matches
// whose category equals the value — the category is never silently
// ignored because a keyword is present.
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository.searchRanked — combined category + keyword (task 2.1)', () => {
  const combDb = openMigratedD1();
  const combRepo = new D1ProductSearchRepository(combDb.d1);

  beforeAll(async () => {
    // Two beer rows and one wine row that ALL match 'karhu', plus a beer
    // row that does not match — the combined path must exclude exactly
    // the cross-category match, never the in-category non-match's
    // siblings.
    const rows = [
      { id: 4001, name: 'Karhu Pinta', brand: 'Karhu', category: 'beer' },
      { id: 4002, name: 'Karhu III Velvet', brand: 'Karhu', category: 'beer' },
      { id: 4003, name: 'Karhuvuori Punaviini', brand: 'Karhuvuori', category: 'wine_still' },
      { id: 4004, name: 'Koff III', brand: 'Koff', category: 'beer' },
    ];
    for (const r of rows) {
      await combRepo.create({
        id: r.id,
        name: r.name,
        manufacturer: 'Yhdistelmä Panimo',
        brand: r.brand,
        category: r.category,
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: r.category,
        depositSystemStatus: true,
        ean: null,
      });
    }
  });

  it('applies the category together with q — only keyword matches in the category', async () => {
    const combined = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'beer');
    expect(combined).toHaveLength(2);
    expect(combined.map((r) => r.id)).toEqual(expect.arrayContaining([4001, 4002]));
    expect(combined.every((r) => r.category === 'beer')).toBe(true);
  });

  it('never silently ignores the category — the unfiltered ranking contains the excluded row', async () => {
    const unfiltered = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE);
    expect(unfiltered.map((r) => r.id)).toEqual(
      expect.arrayContaining([4001, 4002, 4003]),
    );
    const combined = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'beer');
    expect(combined.map((r) => r.id)).not.toContain(4003);
  });

  it('the LIKE recall path respects the combined filter too', async () => {
    // 'karhuvuor' is a mid-token substring — FTS prefix cannot express
    // it; only the LIKE merge finds the row. With the category filter it
    // survives in wine_still and is excluded from beer.
    const wine = await combRepo.searchRanked('karhuvuor', MAX_PAGE_SIZE, 'wine_still');
    expect(wine.map((r) => r.id)).toEqual([4003]);
    const beer = await combRepo.searchRanked('karhuvuor', MAX_PAGE_SIZE, 'beer');
    expect(beer).toEqual([]);
  });

  it('zero combined matches is an honest empty set, not a fallback', async () => {
    // Karhu matches exist, but none in spirits — no silent unfiltered
    // fallback, no other-category rows.
    const none = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'spirits');
    expect(none).toEqual([]);
  });

  it('the limit applies to the combined set — a prefix of the combined order', async () => {
    const full = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'beer');
    for (const k of [1, 2]) {
      const sliced = await combRepo.searchRanked('karhu', k, 'beer');
      expect(sliced.map((r) => r.id)).toEqual(full.slice(0, k).map((r) => r.id));
    }
  });

  it('is deterministic across repeated combined calls', async () => {
    const first = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'beer');
    const second = await combRepo.searchRanked('karhu', MAX_PAGE_SIZE, 'beer');
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
  });
});

// ---------------------------------------------------------------------------
// Finnish synonym expansion + LIKE-merge scarcity gate (task 3.1, change
// finnish-first-client-experience) — isolated fixture DBs. Spec
// product-search: expansion through the curated synonym map is monotone
// (never narrows), and the LIKE '%q%' merge is consulted only when the
// FTS token-match candidate count is below the listing page size.
// ---------------------------------------------------------------------------

/** Unbounded FTS candidate count for a raw MATCH expression. */
async function ftsCount(
  handle: ReturnType<typeof openMigratedD1>['d1'],
  expression: string,
): Promise<number> {
  const row = await handle
    .prepare(
      'SELECT count(*) AS n FROM product_master_fts WHERE product_master_fts MATCH ?',
    )
    .bind(expression)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** FTS-matched product ids for a raw MATCH expression, id ASC. */
async function ftsMatchedIds(
  handle: ReturnType<typeof openMigratedD1>['d1'],
  expression: string,
): Promise<number[]> {
  const rows = (
    await handle
      .prepare(
        `SELECT p.id AS id
           FROM product_master_fts f
           JOIN product_master p ON p.id = f.rowid
          WHERE product_master_fts MATCH ?
          ORDER BY p.id`,
      )
      .bind(expression)
      .all<{ id: number }>()
  ).results;
  return rows.map((row) => row.id);
}

/** The pre-task-3.1 phrase builder — the un-expanded expression baseline. */
function legacyMatchExpression(tokens: readonly string[]): string {
  return `"${tokens.map((t) => t.replace(/"/g, '""')).join('" "')}" *`;
}

describe('buildMatchExpression — synonym OR-groups (task 3.1)', () => {
  it('expands a Finnish token to every group member, each carrying the final-token prefix', () => {
    expect(buildMatchExpression(['viski'])).toBe('"viski" * OR "whisky" *');
    expect(buildMatchExpression(['olut'])).toBe(
      '"olut" * OR "beer" * OR "oluet" *',
    );
  });

  it('keeps group-less tokens exactly on the legacy expression (golden parity)', () => {
    expect(buildMatchExpression(['karhu'])).toBe('"karhu" *');
    expect(buildMatchExpression(['le', 'coq'])).toBe('"le coq" *');
  });

  it('keeps adjacency across groups for multi-token queries (group-product phrases)', () => {
    expect(buildMatchExpression(['karhu', 'olut'])).toBe(
      '"karhu olut" * OR "karhu beer" * OR "karhu oluet" *',
    );
    // The final token's prefix expansion applies to every member of its
    // group; non-final positions stay exact.
    expect(buildMatchExpression(['viski', 'pullo'])).toBe(
      '"viski pullo" * OR "whisky pullo" *',
    );
  });

  it('quotes multi-word group members as FTS phrases', () => {
    expect(buildMatchExpression(['punaviini'])).toBe(
      '"punaviini" * OR "red wine" *',
    );
  });

  it('wires every curated group: each member appears in the head member’s expression', () => {
    for (const group of FINNISH_SYNONYM_GROUPS) {
      const expression = buildMatchExpression([group[0]]);
      for (const member of group) {
        expect(expression).toContain(`"${member}"`);
      }
    }
  });

  it('bounds the group-product of long queries, original phrase first (the monotone anchor)', () => {
    // 3·2·3·2·2 = 72 combinations — above the bound.
    const tokens = ['olut', 'viski', 'konjakki', 'siideri', 'viina'];
    const arms = buildMatchExpression(tokens).split(' OR ');
    expect(arms.length).toBe(MAX_MATCH_PHRASES);
    // The un-expanded phrase is the FIRST arm — even a truncated
    // expression retains the legacy disjunct, so expansion can never
    // narrow a result set.
    expect(arms[0]).toBe(`"${tokens.join(' ')}" *`);
  });
});

describe('D1ProductSearchRepository.searchRanked — Finnish synonym recall (task 3.1)', () => {
  const synDb = openMigratedD1();
  const synRepo = new D1ProductSearchRepository(synDb.d1);

  // Fixture layout (ids grouped by purpose):
  // - 6301..6319: nineteen 'Olutpaja …' rows — token-prefix ('olut*') matches;
  // - 6030 'Karhu Pohjolainen Olut' brings the 'olut*' FTS candidate count
  //   to EXACTLY the page size (20) — the gate's "at or above" boundary;
  // - 6020/6021 'Absolut …' — the live incident noise: 'Abs(olut)' matches
  //   the LIKE '%olut%' merge but never the FTS token prefix;
  // - viski/whisky, cognac/brandy, vodka/viina rows — expansion recall pins.
  const OLUTPAJA_IDS = Array.from({ length: 19 }, (_, i) => 6301 + i);
  const KARHU_OLUT_ID = 6030;
  const ABSOLUT_IDS = [6020, 6021];
  const VISKI_ID = 6101;
  const WHISKY_IDS = [6102, 6103];
  const COGNAC_ID = 6111;
  const BRANDY_ID = 6110;
  const VODKA_ID = 6120;
  const VIINA_ID = 6121;

  beforeAll(async () => {
    const seeds: ReadonlyArray<{
      id: number;
      name: string;
      brand: string;
      category: string;
    }> = [
      ...OLUTPAJA_IDS.map((id, i) => ({
        id,
        name: `Olutpaja Erityis ${String(i + 1).padStart(2, '0')}`,
        brand: 'Olutpaja',
        category: 'beer',
      })),
      { id: KARHU_OLUT_ID, name: 'Karhu Pohjolainen Olut', brand: 'Karhu', category: 'beer' },
      { id: 6020, name: 'Absolut Vodka Original', brand: 'Absolut', category: 'spirits' },
      { id: 6021, name: 'Absolut Vodka Citron', brand: 'Absolut', category: 'spirits' },
      { id: VISKI_ID, name: 'Teerenpeli Viski', brand: 'Teerenpeli', category: 'spirits' },
      { id: 6102, name: 'Highland Park Whisky 12', brand: 'Highland Park', category: 'spirits' },
      { id: 6103, name: 'Glenfiddich Whisky 15', brand: 'Glenfiddich', category: 'spirits' },
      { id: BRANDY_ID, name: 'Frania Brandy', brand: 'Frania', category: 'spirits' },
      { id: COGNAC_ID, name: 'Hennessy Cognac', brand: 'Hennessy', category: 'spirits' },
      { id: VODKA_ID, name: 'Finlandia Vodka', brand: 'Finlandia', category: 'spirits' },
      { id: VIINA_ID, name: 'Salmiakki Viina', brand: 'Salmiakki', category: 'spirits' },
    ];
    for (const seed of seeds) {
      await synRepo.create({
        id: seed.id,
        name: seed.name,
        manufacturer: 'Synonyymi Panimo',
        brand: seed.brand,
        category: seed.category,
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: seed.category,
        depositSystemStatus: true,
        ean: null,
      });
    }
  });

  it('spec: "viski" recalls the English-language whisky catalog — parity with "whisky"', async () => {
    const viski = (await synRepo.searchRanked('viski', MAX_PAGE_SIZE))
      .map((r) => r.id)
      .sort((a, b) => a - b);
    const whisky = (await synRepo.searchRanked('whisky', MAX_PAGE_SIZE))
      .map((r) => r.id)
      .sort((a, b) => a - b);
    // Both terms recall the viski row AND the whisky rows…
    expect(viski).toEqual(expect.arrayContaining([VISKI_ID, ...WHISKY_IDS]));
    expect(whisky).toEqual(expect.arrayContaining([VISKI_ID, ...WHISKY_IDS]));
    // …with equal recall — the Finnish term reaches exactly the English set.
    expect(viski).toEqual(whisky);
  });

  it('spec: expansion is monotone — each expanded query is a superset of its un-expanded query', async () => {
    for (const tokens of [
      ['viski'],
      ['olut'],
      ['konjakki'],
      ['viina'],
      ['teerenpeli', 'viski'],
    ]) {
      const unExpandedIds = await ftsMatchedIds(
        synDb.d1,
        legacyMatchExpression(tokens),
      );
      const expandedIds = (
        await synRepo.searchRanked(tokens.join(' '), MAX_PAGE_SIZE)
      ).map((r) => r.id);
      expect(expandedIds).toEqual(expect.arrayContaining(unExpandedIds));
    }
  });

  it('expansion recalls across the curated groups: viina→vodka, konjakki→cognac/brandy', async () => {
    const viina = (await synRepo.searchRanked('viina', MAX_PAGE_SIZE)).map(
      (r) => r.id,
    );
    expect(viina).toEqual(
      expect.arrayContaining([VODKA_ID, VIINA_ID, ...ABSOLUT_IDS]),
    );
    const konjakki = (await synRepo.searchRanked('konjakki', MAX_PAGE_SIZE)).map(
      (r) => r.id,
    );
    expect(konjakki).toEqual(expect.arrayContaining([COGNAC_ID, BRANDY_ID]));
  });

  it('a capped pathological expression stays executable MATCH SQL', async () => {
    // No fixture row carries any five-token synonym combination — zero
    // hits, but the bounded expression must parse and run.
    const expression = buildMatchExpression([
      'olut',
      'viski',
      'konjakki',
      'siideri',
      'viina',
    ]);
    expect(await ftsCount(synDb.d1, expression)).toBe(0);
  });

  it('spec: "olut" at ≥ page-size token matches — the head is clean of brand-substring noise (Absolut incident)', async () => {
    // Precondition, explicit: token matches sit exactly AT the threshold
    // (19 Olutpaja rows + Karhu Olut) — the "at or above" boundary.
    expect(await ftsCount(synDb.d1, '"olut" *')).toBe(SEARCH_PAGE_SIZE);
    expect(
      await ftsCount(synDb.d1, buildMatchExpression(tokenize('olut'))),
    ).toBe(SEARCH_PAGE_SIZE);

    const rows = await synRepo.searchRanked('olut', MAX_PAGE_SIZE);
    const ids = rows.map((r) => r.id);
    // The merge is skipped: exactly the token matches come back, and the
    // 'Abs(olut)' brand-substring rows cannot crowd the head.
    expect(rows).toHaveLength(SEARCH_PAGE_SIZE);
    for (const id of ABSOLUT_IDS) {
      expect(ids).not.toContain(id);
    }
    expect(rows.some((r) => r.brand.toLowerCase().includes('absolut'))).toBe(
      false,
    );
    // Every head row is a genuine token match — some name token starts
    // with 'olut' — including the Karhu Olut row.
    expect(ids).toContain(KARHU_OLUT_ID);
    for (const row of rows) {
      expect(tokenize(row.name).some((t) => t.startsWith('olut'))).toBe(true);
    }
  });

  it('spec: "arhu" produces no FTS token matches — the merge runs and recalls Karhu', async () => {
    // Fragment recall survives the gate: zero token matches is as scarce
    // as it gets, so the mid-token LIKE merge fires.
    expect(await ftsCount(synDb.d1, '"arhu" *')).toBe(0);
    const rows = await synRepo.searchRanked('arhu', MAX_PAGE_SIZE);
    expect(rows.map((r) => r.id)).toEqual([KARHU_OLUT_ID]);
  });

  it('the gate counts category-narrowed candidates — the combined path skips the merge at the threshold', async () => {
    // In-category token matches = 20 → merge skipped; only beer rows.
    const rows = await synRepo.searchRanked('olut', MAX_PAGE_SIZE, 'beer');
    expect(rows).toHaveLength(SEARCH_PAGE_SIZE);
    expect(rows.every((r) => r.category === 'beer')).toBe(true);
    const ids = rows.map((r) => r.id);
    for (const id of ABSOLUT_IDS) {
      expect(ids).not.toContain(id);
    }
  });
});

describe('D1ProductSearchRepository.searchRanked — merge gate below the page size (task 3.1)', () => {
  const belowDb = openMigratedD1();
  const belowRepo = new D1ProductSearchRepository(belowDb.d1);
  const BELOW_TOKEN_MATCH_IDS = Array.from({ length: 18 }, (_, i) => 6401 + i);
  const BELOW_ABSOLUT_IDS = [6420, 6421];

  beforeAll(async () => {
    for (let i = 0; i < BELOW_TOKEN_MATCH_IDS.length; i++) {
      await belowRepo.create({
        id: BELOW_TOKEN_MATCH_IDS[i],
        name: `Olutpaja Erityis ${String(i + 1).padStart(2, '0')}`,
        manufacturer: 'Synonyymi Panimo',
        brand: 'Olutpaja',
        category: 'beer',
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: 'beer',
        depositSystemStatus: true,
        ean: null,
      });
    }
    for (const id of BELOW_ABSOLUT_IDS) {
      await belowRepo.create({
        id,
        name: `Absolut Vodka ${id === 6420 ? 'Original' : 'Citron'}`,
        manufacturer: 'Synonyymi Panimo',
        brand: 'Absolut',
        category: 'spirits',
        alcoholByVolume: '0.400',
        unitVolume: '0.50',
        containerType: 'glass',
        regulatoryClassification: 'spirits',
        depositSystemStatus: null,
        ean: null,
      });
    }
  });

  it('strictly below the page size the merge still fires — substring rows appended after the token matches (semantics unchanged)', async () => {
    // Precondition: 18 token matches, strictly below SEARCH_PAGE_SIZE.
    expect(await ftsCount(belowDb.d1, '"olut" *')).toBe(18);

    const rows = await belowRepo.searchRanked('olut', MAX_PAGE_SIZE);
    const ids = rows.map((r) => r.id);
    // The 'Abs(olut)' substring rows ARE recalled below the gate — the
    // pre-gate merge behavior, unchanged.
    expect(ids).toEqual(expect.arrayContaining(BELOW_ABSOLUT_IDS));
    expect(rows).toHaveLength(
      BELOW_TOKEN_MATCH_IDS.length + BELOW_ABSOLUT_IDS.length,
    );
    // Merge semantics unchanged: FTS relevance order first (the 18 token
    // matches), then the LIKE-only rows appended in id ASC order.
    expect(ids.slice(0, BELOW_TOKEN_MATCH_IDS.length)).toEqual(
      expect.arrayContaining(BELOW_TOKEN_MATCH_IDS),
    );
    expect(ids.slice(BELOW_TOKEN_MATCH_IDS.length)).toEqual(BELOW_ABSOLUT_IDS);
  });
});

// ---------------------------------------------------------------------------
// Zero-result did-you-mean (task 3.2, change finnish-first-client-
// experience; vocabulary widened in task 2.1, change
// consumer-clarity-and-discovery) — isolated fixture DB so the
// shared-database describes above are untouched. Spec product-search: a
// zero-result keyword query carries an optional `suggestion` computed by
// bounded edit distance (≤ 2) against the CLOSED VOCABULARY UNION —
// distinct brand values, distinct product-name tokens, and curated
// FINNISH_SYNONYM_GROUPS members — on diacritic-folded keys; ordering is
// (distance, then alphabetical); results, no candidate, or no token → no
// suggestion.
// ---------------------------------------------------------------------------

describe('did-you-mean primitives — foldComparisonKey + boundedEditDistance (task 3.2)', () => {
  it('folds ä/ö/å to a/o/a on the lowercased key — comparison only', () => {
    expect(foldComparisonKey('KoskenKörva')).toBe('koskenkorva');
    expect(foldComparisonKey('SKÅL')).toBe('skal');
    expect(foldComparisonKey('BRÄNNVIN')).toBe('brannvin');
    expect(foldComparisonKey('Äöå')).toBe('aoa');
  });

  it('classic Levenshtein — no transposition shortcut (koskenkrova costs 2)', () => {
    // The r/o transposition decomposes into two substitutions — the spec
    // bound (≤ 2) is exactly why the classic distance must be used.
    expect(
      boundedEditDistance(
        'koskenkrova',
        'koskenkorva',
        SUGGESTION_MAX_EDIT_DISTANCE,
      ),
    ).toBe(2);
    expect(
      boundedEditDistance(
        'jackdanels',
        'jackdaniels',
        SUGGESTION_MAX_EDIT_DISTANCE,
      ),
    ).toBe(1);
    expect(boundedEditDistance('kitten', 'sitting', 10)).toBe(3);
  });

  it('bounds: exact match is 0, beyond the bound saturates at bound + 1', () => {
    expect(boundedEditDistance('karhu', 'karhu', 2)).toBe(0);
    // Folded-key equality is what makes likoori reach likööri (design Q5).
    expect(boundedEditDistance('likoori', foldComparisonKey('likööri'), 2)).toBe(0);
    // True distance 4 — but the bounded variant saturates at bound + 1.
    expect(boundedEditDistance('abc', 'xyzz', 2)).toBe(
      SUGGESTION_MAX_EDIT_DISTANCE + 1,
    );
    // Length-difference guard fires before any DP work.
    expect(boundedEditDistance('a', 'abcde', 2)).toBe(3);
    expect(boundedEditDistance('', 'ab', 2)).toBe(2);
  });
});

describe('D1ProductSearchRepository — zero-result did-you-mean (task 3.2)', () => {
  const sugDb = openMigratedD1();
  const sugRepo = new D1ProductSearchRepository(sugDb.d1);

  // Fixture layout (folded joined keys in comments):
  // - Koskenkorva  → 'koskenkorva'  (the koskenkrova pin, distance 2);
  // - Jack Daniel's → 'jackdaniels' (the jackdanels pin — the joined
  //   multi-word key keeps a de-spaced/de-apostrophed typo reachable);
  // - Karhu / Karju / Kaara → 'karhu' / 'karju' / 'kaara' (tie and
  //   distance-precedence pins: Karhu < Karju alphabetically, Kaara
  //   alphabetically FIRST but always the farthest of the three);
  // - Skål Brännvin → 'skalbrannvin' (folded brand-side key, original
  //   value must come back with å/ä intact).
  const KOSKENKORVA_ID = 6701;
  const JACK_DANIELS_ID = 6702;
  const KARHU_ID = 6703;
  const KARJU_ID = 6704;
  const KAARA_ID = 6705;
  const SKAL_BRANNVIN_ID = 6706;

  beforeAll(async () => {
    const seeds: ReadonlyArray<{
      id: number;
      name: string;
      brand: string;
      category: string;
    }> = [
      { id: KOSKENKORVA_ID, name: 'Koskenkorva Viina 60 %', brand: 'Koskenkorva', category: 'spirits' },
      { id: JACK_DANIELS_ID, name: "Jack Daniel's Old No. 7", brand: "Jack Daniel's", category: 'spirits' },
      { id: KARHU_ID, name: 'Karhu Pohjola', brand: 'Karhu', category: 'beer' },
      { id: KARJU_ID, name: 'Karju Vahva Olut', brand: 'Karju', category: 'beer' },
      { id: KAARA_ID, name: 'Kaara III', brand: 'Kaara', category: 'beer' },
      { id: SKAL_BRANNVIN_ID, name: 'Skål Brännvin 50 %', brand: 'Skål Brännvin', category: 'spirits' },
    ];
    for (const seed of seeds) {
      await sugRepo.create({
        id: seed.id,
        name: seed.name,
        manufacturer: 'Suggestio Panimo',
        brand: seed.brand,
        category: seed.category,
        alcoholByVolume: '0.047',
        unitVolume: '0.33',
        containerType: 'can',
        regulatoryClassification: seed.category,
        depositSystemStatus: true,
        ean: null,
      });
    }
  });

  /** Wrapper convenience: just the suggestion of one query. */
  function suggestionOf(query: string): Promise<string | null> {
    return sugRepo
      .searchRankedWithSuggestion(query, MAX_PAGE_SIZE)
      .then((r) => r.suggestion);
  }

  it('spec: "koskenkrova" (zero results) suggests "Koskenkorva" — distance-2 transposition', async () => {
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'koskenkrova',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]); // the zero-result trigger, explicit
    expect(suggestion).toBe('Koskenkorva');
  });

  it('spec: "jackdanels" (zero results) suggests "Jack Daniel\'s" — the joined multi-word brand key', async () => {
    // The brand's tokenize() tokens joined ('jack' + 'daniel' + 's' →
    // 'jackdaniels') keep the de-spaced/de-apostrophed typo within
    // distance 1; the suggestion VALUE is the original brand string.
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'jackdanels',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]);
    expect(suggestion).toBe("Jack Daniel's");
  });

  it('no suggestion when the query has results — the vocabulary is never consulted', async () => {
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'koskenkorva',
      MAX_PAGE_SIZE,
    );
    expect(items.map((r) => r.id)).toContain(KOSKENKORVA_ID);
    expect(suggestion).toBeNull();
  });

  it('stable tie ordering: "karu" ties Karhu/Karju at distance 1 and picks the alphabetically first', async () => {
    // karu → karhu (insert h, 1) and karu → karju (insert j, 1); kaara is
    // farther (2). The Finnish-collation tie puts Karhu ahead — and the
    // same call returns the identical string on every repeat.
    expect(await suggestionOf('karu')).toBe('Karhu');
    expect(await suggestionOf('karu')).toBe('Karhu');
    expect(await suggestionOf('karu')).toBe('Karhu');
  });

  it('distance beats alphabetical position: "krrju" picks Karju (1) over the earlier-sorted Karhu (2)', async () => {
    // Kaara and Karhu both sort before Karju, but Karju is the nearest
    // candidate — (distance, then alphabetical) must never let an
    // alphabetically earlier but farther brand win.
    expect(await suggestionOf('krrju')).toBe('Karju');
  });

  it('folded keys: "koskenkörva" reaches Koskenkorva, and the diacritic-less brand spelling returns the original å/ä value', async () => {
    // Query-side fold: ö→o turns the Finnish-keyboard near-miss into an
    // exact folded key (distance 0 — kept on purpose, design Q5's
    // likoori → likööri case).
    expect(await suggestionOf('koskenkörva')).toBe('Koskenkorva');
    // Brand-side fold + value preservation: the user typed pure ASCII,
    // the suggestion is the original 'Skål Brännvin', never the key.
    expect(await suggestionOf('skalbrannvin')).toBe('Skål Brännvin');
  });

  it('multi-token queries target the longest token, first occurrence on ties', async () => {
    // 'koskenkrova' (11) outranks 'olutxxx' (7) as the significant token.
    expect(await suggestionOf('olutxxx koskenkrova')).toBe('Koskenkorva');
    // Equal length → the FIRST occurrence wins: 'kaara' (→ Kaara, exact),
    // not 'karhu'.
    expect(await suggestionOf('kaara karhu')).toBe('Kaara');
  });

  it('no candidate within the bound → null', async () => {
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'zzzzzz',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]);
    expect(suggestion).toBeNull();
  });

  it('a blank query stays the alphabetical listing and never suggests', async () => {
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      '   ',
      MAX_PAGE_SIZE,
    );
    expect(items).toHaveLength(6);
    expect(suggestion).toBeNull();
  });

  it('the wrapper passes the ranked items through unchanged — suggestion rides beside them', async () => {
    const direct = await sugRepo.searchRanked('karhu', 1);
    const wrapped = await sugRepo.searchRankedWithSuggestion('karhu', 1);
    expect(wrapped.items).toEqual(direct);
    expect(wrapped.suggestion).toBeNull();
  });

  // --- Widened vocabulary union (task 2.1, change
  // --- consumer-clarity-and-discovery, design D2): brands + name tokens
  // --- + curated synonym members. ---

  it('spec: "votka" (zero results) suggests the synonym-group member "vodka" — a word in no fixture brand', async () => {
    // The misspelled category word lives in no brand; it reaches the
    // vocabulary through the curated ['vodka', 'viina'] group (union
    // arm 3). votka→vodka is distance 1 ('viina' is 4) — the unique
    // nearest member.
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'votka',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]); // not a prefix of anything — truly zero
    expect(suggestion).toBe('vodka');
  });

  it('name-token arm: "pohjila" (zero results) suggests "Pohjola" — a product-name token in no brand', async () => {
    // 'Pohjola' appears only as a token of the name 'Karhu Pohjola'
    // (union arm 2); the suggestion VALUE keeps the name's casing.
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'pohjila',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]);
    expect(suggestion).toBe('Pohjola');
  });

  it('multi-word synonym members key joined: "redwin" suggests "red wine"', async () => {
    // The curated member 'red wine' stores the joined key 'redwine' —
    // the same de-spaced precedent as multi-word brands.
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'redwin',
      MAX_PAGE_SIZE,
    );
    expect(items).toEqual([]);
    expect(suggestion).toBe('red wine');
  });

  it('multi-token queries target the longest token against the union: "olut pohjila" suggests "Pohjola"', async () => {
    // 'pohjila' (7) outranks 'olut' (4) as the significant token — the
    // selection rule holds when the wider arms supply the candidate.
    expect(await suggestionOf('olut pohjila')).toBe('Pohjola');
  });

  it('tie across the union at equal distance resolves alphabetically: "viinut" suggests "viina"', async () => {
    // 'viinut' sits at distance 2 from the name token 'Viina', the
    // synonym member 'viina' AND the synonym member 'viini'. The
    // (distance, then alphabetical) order picks the viina word (a < i;
    // the fi collation's lowercase-first tertiary puts 'viina' ahead of
    // the name token's 'Viina') — stable across requests.
    expect(await suggestionOf('viinut')).toBe('viina');
    expect(await suggestionOf('viinut')).toBe('viina');
    expect(await suggestionOf('viinut')).toBe('viina');
  });

  it('determinism: repeated widened-vocabulary calls return the identical string', async () => {
    const queries = ['votka', 'pohjila', 'redwin'];
    for (const query of queries) {
      const first = await suggestionOf(query);
      expect(first).not.toBeNull();
      for (let i = 0; i < 3; i++) {
        expect(await suggestionOf(query)).toBe(first);
      }
    }
  });

  it('no suggestion when the widened vocabulary itself matches — "vodka" yields results, not a suggestion', async () => {
    // 'vodka' expands through its synonym group to 'viina' too; the FTS
    // arm matches 'Koskenkorva Viina 60 %' via the 'viina' prefix — a
    // productive query never consults the suggestion vocabulary.
    const { items, suggestion } = await sugRepo.searchRankedWithSuggestion(
      'vodka',
      MAX_PAGE_SIZE,
    );
    expect(items.length).toBeGreaterThan(0);
    expect(suggestion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Category ranking candidates (task 1.1, change unitprice-ranking-scale-fix)
// — isolated fixture DB so the shared-database describes above are
// untouched. The single-query candidate JOIN must reproduce, per category,
// exactly the offer set `findOffers` documents: the latest observation per
// (product, merchant), MAX(id) per group.
// ---------------------------------------------------------------------------

describe('D1ProductSearchRepository.listCategoryOfferCandidates (task 1.1)', () => {
  const candDb = openMigratedD1();
  const candRepo = new D1ProductSearchRepository(candDb.d1);

  // Fixture layout:
  // - 8101 (beer): one merchant scraped twice — the older, cheaper row
  //   must be superseded by the later scrape (recency rule);
  // - 8102 (beer): two merchants, alko superseded once — one candidate
  //   row per merchant, each its own latest scrape;
  // - 8103 (beer): no offers — no candidate row at all;
  // - 8104 (spirits): offered, but outside the queried category.
  const OLD_ALKO_ID = 880; // superseded — must never surface
  const LATEST_ALKO_ID = 881;
  const MERCHANT_ALKO_LATEST_ID = 890; // alko's latest for 8102
  const SUPERSEDED_ALKO_ID = 889; // alko's older scrape for 8102
  const EU_IMPORT_ID = 891; // eu-import's only scrape for 8102
  const SPIRITS_OFFER_ID = 895; // out-of-category offer

  beforeAll(async () => {
    const products = [
      { id: 8101, name: 'Kaatoa Kalja', brand: 'Kaatoa', category: 'beer', abv: '0.045', vol: '0.33' },
      { id: 8102, name: 'Kaksikauppa Kalja', brand: 'Kaksikauppa', category: 'beer', abv: '0.050', vol: '0.50' },
      { id: 8103, name: 'Tarjouskalja Ilman Hintoja', brand: 'Tarjouskalja', category: 'beer', abv: null, vol: '0.33' },
      { id: 8104, name: 'Renat Testbrännvin', brand: 'Renat', category: 'spirits', abv: '0.375', vol: '0.50' },
    ];
    for (const p of products) {
      await candRepo.create({
        id: p.id,
        name: p.name,
        manufacturer: 'Kandidaatti Panimo',
        brand: p.brand,
        category: p.category,
        alcoholByVolume: p.abv,
        unitVolume: p.vol,
        containerType: 'can',
        regulatoryClassification: p.category,
        depositSystemStatus: true,
        ean: null,
      });
    }
    await candDb.d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            observed_at, reliability_status)
         VALUES (${OLD_ALKO_ID}, 'alko', 'FI', 8101, 249, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (${LATEST_ALKO_ID}, 'alko', 'FI', 8101, 299, '2026-09-02T10:00:00.000Z', 'VERIFIED'),
                (${SUPERSEDED_ALKO_ID}, 'alko', 'FI', 8102, 250, '2026-09-01T10:00:00.000Z', 'VERIFIED'),
                (${MERCHANT_ALKO_LATEST_ID}, 'alko', 'FI', 8102, 260, '2026-09-02T10:00:00.000Z', 'VERIFIED'),
                (${EU_IMPORT_ID}, 'eu-import', 'EE', 8102, 350, '2026-09-02T10:00:00.000Z', 'ESTIMATED'),
                (${SPIRITS_OFFER_ID}, 'alko', 'FI', 8104, 400, '2026-09-03T10:00:00.000Z', 'VERIFIED')`,
      )
      .run();
  });

  it('recency rule: an older scrape per merchant is ignored — only MAX(id) surfaces', async () => {
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    const forProduct = rows.filter((r) => r.productId === 8101);
    // Exactly one candidate for the single-merchant product: the LATEST
    // scrape, with its own price.
    expect(forProduct).toHaveLength(1);
    expect(forProduct[0]?.offerId).toBe(LATEST_ALKO_ID);
    expect(forProduct[0]?.priceCents).toBe(299);
    // The superseded cheaper row leaks nowhere in the whole result set.
    expect(rows.some((r) => r.offerId === OLD_ALKO_ID)).toBe(false);
    expect(rows.some((r) => r.priceCents === 249 && r.productId === 8101)).toBe(
      false,
    );
  });

  it('multi-merchant products: one candidate per merchant, each the merchant\'s latest', async () => {
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    const forProduct = rows.filter((r) => r.productId === 8102);
    expect(forProduct).toHaveLength(2);
    // Ordered by the SQL's (product id, offer id) — both current rows.
    expect(forProduct.map((r) => r.offerId)).toEqual([
      MERCHANT_ALKO_LATEST_ID,
      EU_IMPORT_ID,
    ]);
    expect(forProduct.map((r) => r.priceCents)).toEqual([260, 350]);
    // The superseded alko scrape prices nothing.
    expect(forProduct.some((r) => r.offerId === SUPERSEDED_ALKO_ID)).toBe(false);
  });

  it('category scoping: only the queried category\'s products appear, in SQL', async () => {
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    expect(new Set(rows.map((r) => r.productId))).toEqual(
      new Set([8101, 8102]),
    );
    expect(rows.every((r) => r.category === 'beer')).toBe(true);
    // The spirits product's offer stays out even though it exists.
    expect(rows.some((r) => r.offerId === SPIRITS_OFFER_ID)).toBe(false);

    // And the reverse query scopes just as strictly.
    const spirits = await candRepo.listCategoryOfferCandidates('spirits');
    expect(spirits.map((r) => r.productId)).toEqual([8104]);
    expect(spirits.map((r) => r.offerId)).toEqual([SPIRITS_OFFER_ID]);
  });

  it('products without offers produce no rows', async () => {
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    expect(rows.some((r) => r.productId === 8103)).toBe(false);
  });

  it('a canonical category with no products returns an empty set', async () => {
    expect(
      await candRepo.listCategoryOfferCandidates('intermediate_products'),
    ).toEqual([]);
  });

  it('row shape matches the minimal candidate projection — pg numeric text scales, camelCase, nothing extra', async () => {
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    const row = rows.find((r) => r.offerId === LATEST_ALKO_ID);
    expect(row).toEqual({
      productId: 8101,
      name: 'Kaatoa Kalja',
      brand: 'Kaatoa',
      category: 'beer',
      alcoholByVolume: '0.045', // numeric(5,3) text
      unitVolume: '0.3300', // numeric(10,4) text — pg contract scale
      offerId: LATEST_ALKO_ID,
      priceCents: 299,
      reliabilityStatus: 'VERIFIED',
    });
    // Minimal projection, pinned structurally: no merchant/country/
    // availability/timestamp keys can ride along unnoticed.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'alcoholByVolume',
      'brand',
      'category',
      'name',
      'offerId',
      'priceCents',
      'productId',
      'reliabilityStatus',
      'unitVolume',
    ]);
  });

  it('parity pin: the candidate set per product equals exactly what findOffers implies', async () => {
    // The whole point of design D2: the inline dedup IS the findOffers
    // recency rule, so per product the candidate offer ids must be the
    // identical set findOffers returns — no more, no less.
    const rows = await candRepo.listCategoryOfferCandidates('beer');
    const byProduct = new Map<number, number[]>();
    for (const r of rows) {
      byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r.offerId]);
    }
    for (const productId of [8101, 8102]) {
      const offers = await candRepo.findOffers(productId);
      expect(byProduct.get(productId)).toEqual(offers.map((o) => o.id));
    }
  });

  it('is deterministic across repeated calls — identical rows in identical order', async () => {
    const first = await candRepo.listCategoryOfferCandidates('beer');
    const second = await candRepo.listCategoryOfferCandidates('beer');
    expect(second).toEqual(first);
  });
});

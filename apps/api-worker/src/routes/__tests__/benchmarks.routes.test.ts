/**
 * Benchmarks route tests (task 3.1, change client-experience-improvement)
 * — GET /api/v1/benchmarks/category-averages over the full createApp()
 * composition (harness parity with the other route suites).
 *
 * @module BenchmarksRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedOffer,
  seedProduct,
} from './harness';

const AGE = { 'x-age-confirmed': 'confirmed' };

interface FiguresJson {
  readonly averageCentsPerLitre: number;
  readonly offerCount: number;
  readonly productCount: number;
  readonly asOf: string;
  readonly reliabilityStatus: string;
}

interface BenchmarksBody {
  readonly categories: ReadonlyArray<{
    readonly category: string;
    readonly alko: FiguresJson | null;
    readonly crossBorder: FiguresJson | null;
  }>;
}

/**
 * Fixture: beer with both segments (alko 330 @0.33 l = 1000 c/l latest
 * scrape, saksoinet DE 264 @0.33 l = 800 c/l), wine with only a
 * cross-border segment, spirits untouched. Superseded alko scrape (350)
 * must not drag the beer average.
 */
function seedBenchmarksCatalog(db: ReturnType<typeof openMigratedD1>['db']): void {
  seedProduct(db, { id: 1, name: 'Benchmark Olut', category: 'beer', unitVolume: 0.33 });
  seedOffer(db, { id: 101, productId: 1, merchant: 'alko', country: 'FI', priceCents: 350, observedAt: '2026-09-01T10:00:00.000Z' });
  seedOffer(db, { id: 102, productId: 1, merchant: 'alko', country: 'FI', priceCents: 330, observedAt: '2026-09-02T10:00:00.000Z' });
  seedOffer(db, { id: 104, productId: 1, merchant: 'saksoinet', country: 'DE', priceCents: 264, observedAt: '2026-09-03T10:00:00.000Z', reliabilityStatus: 'ESTIMATED' });
  seedProduct(db, { id: 3, name: 'Benchmark Viini', category: 'wine_still', unitVolume: 0.75 });
  seedOffer(db, { id: 105, productId: 3, merchant: 'saksoinet', country: 'DE', priceCents: 1200, observedAt: '2026-09-03T10:00:00.000Z' });
  seedProduct(db, { id: 4, name: 'Benchmark Viski', category: 'spirits', unitVolume: 0.5 });
}

describe('GET /api/v1/benchmarks/category-averages', () => {
  it('is guarded by the age gate', async () => {
    const { d1 } = openMigratedD1();
    const noAge = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages',
    );
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('returns per-category segment averages with as-of and reliability from observed offers', async () => {
    const { db, d1 } = openMigratedD1();
    seedBenchmarksCatalog(db);
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarksBody;

    expect(body.categories.map((c) => c.category)).toEqual([
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]);

    const beer = body.categories[0]!;
    expect(beer.alko).toEqual({
      averageCentsPerLitre: 1000, // latest alko scrape 330/0.33 — not the 350 scrape
      offerCount: 1,
      productCount: 1,
      asOf: '2026-09-02',
      reliabilityStatus: 'VERIFIED',
    });
    expect(beer.crossBorder).toEqual({
      averageCentsPerLitre: 800,
      offerCount: 1,
      productCount: 1,
      asOf: '2026-09-03',
      reliabilityStatus: 'ESTIMATED',
    });

    const wine = body.categories[1]!;
    expect(wine.alko).toBeNull(); // no domestic coverage — honest absence
    expect(wine.crossBorder?.averageCentsPerLitre).toBe(1600);

    // Categories without any covering offers: absent on both segments —
    // never a fabricated zero (spirits HAS a product, but no offers).
    expect(body.categories[5]).toEqual({
      category: 'spirits',
      alko: null,
      crossBorder: null,
    });
  });

  it('narrows to one canonical category via the category parameter', async () => {
    const { db, d1 } = openMigratedD1();
    seedBenchmarksCatalog(db);
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages?category=beer',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarksBody;
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0]!.category).toBe('beer');
  });

  it('treats a blank category as absent (all categories)', async () => {
    const { db, d1 } = openMigratedD1();
    seedBenchmarksCatalog(db);
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages?category=',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarksBody;
    expect(body.categories).toHaveLength(6);
  });

  it('rejects an unknown category with 400 — the unified envelope, search-route parity', async () => {
    const { d1 } = openMigratedD1();
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages?category=mead',
      { headers: AGE },
    );
    await expectEnvelope(res, 400, {
      message:
        "Unknown category 'mead'. Valid categories: beer, wine_still, wine_sparkling, intermediate_products, other_fermented, spirits.",
    });
  });

  it('an empty catalog reports every category with null segments — honest absence', async () => {
    const { d1 } = openMigratedD1();
    const res = await request(
      buildApp(),
      permissiveEnv(d1),
      '/api/v1/benchmarks/category-averages',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarksBody;
    expect(body.categories).toHaveLength(6);
    for (const entry of body.categories) {
      expect(entry).toEqual({ category: entry.category, alko: null, crossBorder: null });
    }
  });

  it('the same D1 state yields a byte-identical body on every request', async () => {
    const { db, d1 } = openMigratedD1();
    seedBenchmarksCatalog(db);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const first = await request(
      app,
      env,
      '/api/v1/benchmarks/category-averages',
      { headers: AGE },
    );
    const firstText = await first.text();
    const second = await request(
      app,
      env,
      '/api/v1/benchmarks/category-averages',
      { headers: AGE },
    );
    expect(await second.text()).toBe(firstText);
  });
});

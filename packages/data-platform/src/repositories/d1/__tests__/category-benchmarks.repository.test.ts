/**
 * D1CategoryBenchmarkRepository tests (task 3.1, change
 * client-experience-improvement) — the collapse, the segment membership,
 * the mean-of-cents-per-litre math, the as-of/reliability provenance,
 * and honest absence. Pure aggregation is pinned separately from the SQL
 * read so the math cannot hide behind the database.
 *
 * @module D1CategoryBenchmarkRepositoryTest
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1ProductSearchRepository } from '../product-search.repository';
import {
  D1CategoryBenchmarkRepository,
  aggregateBenchmarkSegment,
  aggregateCategoryBenchmarks,
  type CategoryBenchmarkOfferRow,
} from '../category-benchmarks.repository';

const REPO_DB = openMigratedD1();
const repo = new D1CategoryBenchmarkRepository(REPO_DB.d1);
const productRepo = new D1ProductSearchRepository(REPO_DB.d1);

async function seedProduct(
  id: number,
  name: string,
  category: string,
  unitVolume: string,
): Promise<void> {
  await productRepo.create({
    id,
    name,
    manufacturer: 'Benchmark Panimo',
    brand: 'Koekappale',
    category,
    alcoholByVolume: '0.047',
    unitVolume,
    containerType: 'can',
    regulatoryClassification: category,
    depositSystemStatus: true,
    ean: null,
  });
}

async function seedOffer(
  id: number,
  productId: number,
  merchant: string,
  country: string,
  priceCents: number,
  observedAt: string,
  reliabilityStatus: string,
): Promise<void> {
  await REPO_DB.d1
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          availability, observed_at, reliability_status)
       VALUES (?, ?, ?, ?, ?, 'in_stock', ?, ?)`,
    )
    .bind(id, merchant, country, productId, priceCents, observedAt, reliabilityStatus)
    .run();
}

describe('D1CategoryBenchmarkRepository.categoryOfferRows — current-offer collapse', () => {
  beforeAll(async () => {
    // Product 1: two alko scrapes — the superseded cheaper row (350) must
    // not enter the current-catalog set; only the later 330 does.
    await seedProduct(1, 'Benchmark Olut', 'beer', '0.33');
    await seedOffer(101, 1, 'alko', 'FI', 350, '2026-09-01T10:00:00.000Z', 'VERIFIED');
    await seedOffer(102, 1, 'alko', 'FI', 330, '2026-09-02T10:00:00.000Z', 'VERIFIED');
    // Product 2: the alko reference (STALE) plus a domestic non-Alko
    // offer that fits NEITHER named segment.
    await seedProduct(2, 'Toinen Olut', 'beer', '0.5');
    await seedOffer(103, 2, 'alko', 'FI', 750, '2026-09-01T10:00:00.000Z', 'STALE');
    await seedOffer(106, 2, 'k-market', 'FI', 500, '2026-09-03T10:00:00.000Z', 'VERIFIED');
    // Cross-border webshops: beer on product 1, wine on product 3.
    await seedOffer(104, 1, 'saksoinet', 'DE', 264, '2026-09-03T10:00:00.000Z', 'ESTIMATED');
    await seedProduct(3, 'Benchmark Viini', 'wine_still', '0.75');
    await seedOffer(105, 3, 'saksoinet', 'DE', 1200, '2026-09-03T10:00:00.000Z', 'VERIFIED');
  });

  it('collapses to the latest scrape per (product, merchant) and returns benchmark keys', async () => {
    const rows = await repo.categoryOfferRows('beer');
    // 101 superseded by 102; 106 (domestic non-Alko) is still a current
    // catalog offer — the SEGMENT rule excludes it, not the read.
    expect(rows.map((r) => r.productId).sort()).toEqual([1, 1, 2, 2]);
    const alkoRows = rows.filter((r) => r.merchant === 'alko');
    expect(alkoRows.map((r) => r.priceCents)).toEqual([330, 750]);
    expect(alkoRows.every((r) => r.category === 'beer')).toBe(true);
    expect(alkoRows.every((r) => r.unitVolumeLitres > 0)).toBe(true);
  });

  it('narrows by exact category equality', async () => {
    const rows = await repo.categoryOfferRows('wine_still');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe('wine_still');
  });
});

describe('aggregateCategoryBenchmarks over the repository rows', () => {
  it('computes per-category segment figures with as-of and weakest-link reliability', async () => {
    const rows = await repo.categoryOfferRows();
    const [beer, wineStill, , , , spirits] = aggregateCategoryBenchmarks(rows);

    // beer.alko: 330/0.33 = 1000, 750/0.5 = 1500 → mean 1250; two offers,
    // two products; as-of is the covering set's latest observation; the
    // STALE reference drags the figure's status to STALE. The domestic
    // k-market offer is in NEITHER segment (offerCount stays 2).
    expect(beer).toEqual({
      category: 'beer',
      alko: {
        averageCentsPerLitre: 1250,
        offerCount: 2,
        productCount: 2,
        asOf: '2026-09-02',
        reliabilityStatus: 'STALE',
      },
      crossBorder: {
        // 264/0.33 = 800 exactly; single ESTIMATED offer → ESTIMATED.
        averageCentsPerLitre: 800,
        offerCount: 1,
        productCount: 1,
        asOf: '2026-09-03',
        reliabilityStatus: 'ESTIMATED',
      },
    });

    // wine_still has only the DE webshop offer — the Alko segment is an
    // honest null, never a zero.
    expect(wineStill).toEqual({
      category: 'wine_still',
      alko: null,
      crossBorder: {
        averageCentsPerLitre: 1600, // 1200/0.75
        offerCount: 1,
        productCount: 1,
        asOf: '2026-09-03',
        reliabilityStatus: 'VERIFIED',
      },
    });

    // Categories without any covering offers report absence on both
    // segments — no fabricated zeros (spec price-benchmarks).
    expect(spirits).toEqual({ category: 'spirits', alko: null, crossBorder: null });
  });

  it('keeps the canonical category order and is input-order independent', async () => {
    const rows = await repo.categoryOfferRows();
    const reference = aggregateCategoryBenchmarks(rows);
    expect(reference.map((r) => r.category)).toEqual([
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]);
    const shuffled = aggregateCategoryBenchmarks([...rows].reverse());
    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(reference));
  });
});

describe('aggregateBenchmarkSegment — pure math pins', () => {
  function row(
    overrides: Partial<CategoryBenchmarkOfferRow>,
  ): CategoryBenchmarkOfferRow {
    return {
      productId: 1,
      merchant: 'alko',
      country: 'FI',
      category: 'beer',
      unitVolumeLitres: 0.33,
      priceCents: 350,
      observedAt: '2026-09-01T10:00:00.000Z',
      reliabilityStatus: 'VERIFIED',
      ...overrides,
    };
  }

  it('rounds the mean cents-per-litre to two decimals', () => {
    // 350/0.33 + 420/0.33 = 1060.606… + 1272.727… → mean 1166.666… → 1166.67.
    const figure = aggregateBenchmarkSegment([
      row({ productId: 1, priceCents: 350 }),
      row({ productId: 2, priceCents: 420, observedAt: '2026-09-05T10:00:00.000Z' }),
    ]);
    expect(figure?.averageCentsPerLitre).toBe(1166.67);
    expect(figure?.asOf).toBe('2026-09-05');
  });

  it('is null for empty coverage — honest absence, never zero', () => {
    expect(aggregateBenchmarkSegment([])).toBeNull();
  });

  it('excludes non-positive volumes defensively and goes null when nothing usable remains', () => {
    const figure = aggregateBenchmarkSegment([
      row({ productId: 1 }),
      row({ productId: 2, priceCents: 420, unitVolumeLitres: 0, observedAt: '2026-09-05T10:00:00.000Z' }),
    ]);
    // Only the 0.33 l row is priced in — the zero-volume row is corrupt
    // data the ingestion gate prevents, never a divide-by-zero.
    expect(figure).toEqual({
      averageCentsPerLitre: 1060.61,
      offerCount: 1,
      productCount: 1,
      asOf: '2026-09-01',
      reliabilityStatus: 'VERIFIED',
    });
    expect(aggregateBenchmarkSegment([row({ unitVolumeLitres: 0 })])).toBeNull();
  });

  it('an unknown stored reliability status is treated as UNAVAILABLE, never VERIFIED', () => {
    const figure = aggregateBenchmarkSegment([
      row({ reliabilityStatus: 'SOMETHING_ELSE' }),
    ]);
    expect(figure?.reliabilityStatus).toBe('UNAVAILABLE');
  });
});

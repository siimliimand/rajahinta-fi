/**
 * D1ProductMasterQueryRepository — real-SQLite tests (task 1.3, change
 * alko-reference-matching-pipeline) on the node:sqlite harness with the
 * committed migrations applied (0000 → 0026).
 *
 * The load-bearing cases are design D3's blocked retrieval: category
 * equality rides `product_master_category_idx` (EXPLAIN QUERY PLAN, the
 * migration-0023 precedent), the ABV/volume bands behave as the
 * documented bucket math, unusable seed numerics WIDEN instead of
 * crashing, and the row→domain assembly tolerates the German scrape
 * noise (zero volumes, missing ABV) without ever throwing.
 *
 * @module D1ProductMasterQueryRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1ProductMasterQueryRepository,
  canonicalCategoryToStored,
  findCandidatesSql,
  normalizedProductFromMasterRow,
  productMasterRecordFromRow,
  storedCategoryToCanonical,
  FIND_CANDIDATES_LIMIT,
  type D1ProductMasterQueryRow,
} from '../product-master-query.repository';
import { scoreProduct } from '@rajahinta/core-domain';
import type { D1DatabaseLike } from '../../../d1/executor';

function makeRepo(): {
  db: ReturnType<typeof openMigratedD1>['db'];
  d1: D1DatabaseLike;
  repo: D1ProductMasterQueryRepository;
} {
  const { db, d1 } = openMigratedD1();
  return { db, d1, repo: new D1ProductMasterQueryRepository(d1) };
}

/** A product_master row as ingestion writes it (ABV as FRACTION). */
interface SeedProduct {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  /** Stored fraction (percent / 100) or null — the column's real shape. */
  readonly alcoholByVolume: number | null;
  readonly unitVolume: number;
  readonly ean: string | null;
  readonly containerType?: string;
}

async function seedProduct(d1: D1DatabaseLike, product: SeedProduct): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type,
          regulatory_classification, ean)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      product.id,
      product.name,
      product.brand,
      product.brand,
      product.category,
      product.alcoholByVolume,
      product.unitVolume,
      product.containerType ?? 'can',
      product.category,
      product.ean,
    )
    .run();
}

/**
 * The blocking fixture: every bucket neighborhood around the standard
 * seed {beer, abv 5.0 pp (bucket 10), volume 0.5 l (bucket 10)} —
 * in-window rows, one-too-far rows on each axis, a foreign category,
 * and the unusable-value rows the widening rules talk about.
 */
const FIXTURE: readonly SeedProduct[] = [
  { id: 10, name: 'Olut A', brand: 'Brand A', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.5, ean: null },
  { id: 11, name: 'Olut B', brand: 'Brand B', category: 'beer', alcoholByVolume: 0.045, unitVolume: 0.45, ean: null },
  { id: 12, name: 'Olut C', brand: 'Brand C', category: 'beer', alcoholByVolume: 0.055, unitVolume: 0.55, ean: null },
  { id: 13, name: 'Olut D', brand: 'Brand D', category: 'beer', alcoholByVolume: 0.04, unitVolume: 0.4, ean: null },
  { id: 14, name: 'Olut E', brand: 'Brand E', category: 'beer', alcoholByVolume: 0.06, unitVolume: 0.6, ean: null },
  { id: 15, name: 'Viini F', brand: 'Brand F', category: 'wine_still', alcoholByVolume: 0.125, unitVolume: 0.75, ean: null },
  { id: 16, name: 'Olut G', brand: 'Brand G', category: 'beer', alcoholByVolume: null, unitVolume: 0.5, ean: null },
  { id: 17, name: 'Olut H', brand: 'Brand H', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0, ean: null },
  { id: 18, name: 'Olut I', brand: 'Brand I', category: 'beer', alcoholByVolume: 0.05, unitVolume: 0.4, ean: null },
  { id: 19, name: 'Olut J', brand: 'Brand J', category: 'beer', alcoholByVolume: 0.04, unitVolume: 0.5, ean: null },
  { id: 20, name: 'Olut K', brand: 'Brand K', category: 'beer', alcoholByVolume: 0.047, unitVolume: 0.5, ean: '6410805001237' },
];

async function seedFixture(d1: D1DatabaseLike, rows: readonly SeedProduct[]): Promise<void> {
  for (const row of rows) {
    await seedProduct(d1, row);
  }
}

const idsOf = (records: Array<{ id: number }>): number[] => records.map((r) => r.id);

describe('D1ProductMasterQueryRepository.findByEan', () => {
  it('returns the row on an exact barcode hit, ABV converted fraction→percent', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, {
      id: 20, name: 'Olut K', brand: 'Brand K', category: 'beer',
      alcoholByVolume: 0.047, unitVolume: 0.5, ean: '6410805001237',
    });

    const record = await repo.findByEan('6410805001237');
    expect(record).not.toBeNull();
    expect(record!.id).toBe(20);
    expect(record!.ean).toBe('6410805001237');
    expect(record!.normalizedName).toBe('Olut K');
    expect(record!.normalizedBrand).toBe('Brand K');
    expect(record!.canonicalCategory).toBe('beer');
    // Stored 0.047 fraction → port contract's percent scale.
    expect(record!.alcoholByVolume).toBeCloseTo(4.7, 10);
    expect(record!.volumeLitres).toBe(0.5);
  });

  it('returns null on a miss and never on a null-ean row', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, {
      id: 21, name: 'No Barcode', brand: 'Brand X', category: 'beer',
      alcoholByVolume: 0.05, unitVolume: 0.5, ean: null,
    });

    expect(await repo.findByEan('9999999999999')).toBeNull();
    // `ean = ?` can never bind NULL — the null-ean row is unreachable.
    expect(await repo.findByEan('')).toBeNull();
  });

  it('treats a stored percentage-scale ABV (> 1) as already-percent, never ×100', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, {
      id: 22, name: 'Straggler', brand: 'Brand S', category: 'beer',
      alcoholByVolume: 4.7, unitVolume: 0.5, ean: '4000000000004',
    });

    const record = await repo.findByEan('4000000000004');
    expect(record!.alcoholByVolume).toBeCloseTo(4.7, 10);
  });
});

describe('D1ProductMasterQueryRepository.findCandidates — category mapping', () => {
  it('maps the canonical query onto the stored tax key and back onto the record', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, { id: 30, name: 'Kuohuviini', brand: 'B', category: 'wine_sparkling', alcoholByVolume: 0.115, unitVolume: 0.75, ean: null });
    await seedProduct(d1, { id: 31, name: 'Viski', brand: 'B', category: 'spirits', alcoholByVolume: 0.4, unitVolume: 0.5, ean: null });

    const sparkling = await repo.findCandidates({ brand: 'B', category: 'sparkling-wine', volumeLitres: 0.75, abv: 11.5 });
    expect(idsOf(sparkling)).toEqual([30]);
    expect(sparkling[0].canonicalCategory).toBe('sparkling-wine');

    const spirits = await repo.findCandidates({ brand: 'B', category: 'spirits', volumeLitres: 0.5, abv: 40 });
    expect(idsOf(spirits)).toEqual([31]);
    expect(spirits[0].alcoholByVolume).toBe(40);
  });
});

describe('D1ProductMasterQueryRepository.findCandidates — blocking windows', () => {
  it('returns exactly the ±1-bucket set for a usable seed, ordered by id', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    // Seed 5.0 % / 0.5 l → ABV bucket 10, volume bucket 10 → windows [9, 11].
    const candidates = await repo.findCandidates({
      brand: 'Karhu', category: 'beer', volumeLitres: 0.5, abv: 5,
    });

    // 11 (−1/−1), 12 (+1/+1), 10 (center), 20 (4.7 % → bucket 9, in-window).
    // 13/14 are one bucket too far on both axes, 18 is volume-blocked
    // with fine ABV, 19 is ABV-blocked with fine volume, 16 (null ABV)
    // and 17 (zero volume) fail the bands against a usable seed, 15 is
    // another category.
    expect(idsOf(candidates)).toEqual([10, 11, 12, 20]);
  });

  it('blocks on category equality only — brand is a scoring axis, not a filter', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    const candidates = await repo.findCandidates({
      brand: 'Totally Unrelated', category: 'beer', volumeLitres: 0.5, abv: 5,
    });
    expect(new Set(candidates.map((c) => c.normalizedBrand))).toEqual(
      new Set(['Brand A', 'Brand B', 'Brand C', 'Brand K']),
    );
  });

  it('excludes a different category even with identical numbers', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    const candidates = await repo.findCandidates({
      brand: 'x', category: 'wine', volumeLitres: 0.5, abv: 5,
    });
    expect(candidates).toEqual([]);
  });

  it('a zero-volume seed drops the volume band: all volumes surface, including the zero-volume candidate', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    const candidates = await repo.findCandidates({
      brand: 'x', category: 'beer', volumeLitres: 0, abv: 5,
    });

    // Volume band gone: 17 (unit_volume = 0) and 18 (0.4 l, out-of-band)
    // surface; the ABV band still holds (19 at bucket 8 stays out, and
    // null-ABV 16 stays out against a usable seed ABV).
    expect(idsOf(candidates)).toEqual([10, 11, 12, 17, 18, 20]);
  });

  it('a zero-ABV seed drops the ABV band: the null-ABV candidate surfaces', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    const candidates = await repo.findCandidates({
      brand: 'x', category: 'beer', volumeLitres: 0.5, abv: 0,
    });

    // ABV band gone: 16 (null ABV) and 19 (bucket 8) surface; the
    // volume band still holds (17 at bucket 0 and 18 at bucket 8 stay
    // out). 20 stays in (bucket 9 volume 10).
    expect(idsOf(candidates)).toEqual([10, 11, 12, 16, 19, 20]);
  });

  it('both numerics unusable: the whole category surfaces, ordered and capped deterministically', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    const candidates = await repo.findCandidates({
      brand: 'x', category: 'beer', volumeLitres: 0, abv: 0,
    });
    // Every beer row, wine still excluded, ascending by id.
    expect(idsOf(candidates)).toEqual([10, 11, 12, 13, 14, 16, 17, 18, 19, 20]);
  });

  it('the ±1 window straddles the JS/SQL rounding tie (seed 5.25 pp keeps the 5.0 % candidate)', async () => {
    const { d1, repo } = makeRepo();
    await seedProduct(d1, FIXTURE[0]); // 5.0 % → candidate-side bucket rounds the stored fraction up to 10
    await seedProduct(d1, { ...FIXTURE[1], id: 40, alcoholByVolume: 0.04, unitVolume: 0.5 }); // 4.0 % → bucket 8

    // Seed-side JS bucket: Math.round(5.25 / 0.5) = 11 — the exact tie.
    // The 5.0 % candidate rounds to bucket 10 in SQL and must stay in
    // window (|10 − 11| = 1); the 4.0 % one at bucket 8 must not.
    const candidates = await repo.findCandidates({
      brand: 'x', category: 'beer', volumeLitres: 0.5, abv: 5.25,
    });
    expect(idsOf(candidates)).toEqual([10]);
  });

  it('caps the result at FIND_CANDIDATES_LIMIT rows, lowest ids first', async () => {
    const { db, repo } = makeRepo();
    const rows = Array.from(
      { length: FIND_CANDIDATES_LIMIT + 1 },
      (_, i) =>
        `(${1000 + i}, 'B${i}', 'M', 'Brand', 'beer', 0.05, 0.5, 'can', 'beer', NULL)`,
    ).join(', ');
    db.exec(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type,
          regulatory_classification, ean)
       VALUES ${rows}`,
    );

    const candidates = await repo.findCandidates({
      brand: 'x', category: 'beer', volumeLitres: 0.5, abv: 5,
    });
    expect(candidates).toHaveLength(FIND_CANDIDATES_LIMIT);
    expect(candidates[0].id).toBe(1000);
    expect(candidates[FIND_CANDIDATES_LIMIT - 1].id).toBe(1000 + FIND_CANDIDATES_LIMIT - 1);
  });
});

describe('D1ProductMasterQueryRepository — the query rides product_master_category_idx', () => {
  const expectCategoryIndexPlan = (options: {
    abvBlocked: boolean;
    volumeBlocked: boolean;
  }): void => {
    const { db } = makeRepo();
    // A couple of rows so the planner reasons over a non-empty table
    // (the migration-0023 precedent); equality index choice does not
    // depend on the values.
    db.prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
       VALUES (1, 'A', 'M', 'B', 'beer', 0.5, 'can', 'beer'),
              (2, 'V', 'M', 'B', 'wine_still', 0.75, 'bottle', 'wine_still')`,
    ).run();
    const args: Array<string | number> = ['beer'];
    if (options.abvBlocked) args.push(9, 11);
    if (options.volumeBlocked) args.push(9, 11);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${findCandidatesSql(options)}`)
      .all(...args) as { detail: string }[];
    const details = plan.map((r) => r.detail).join('\n');
    expect(details).toMatch(
      /SEARCH product_master USING (COVERING )?INDEX product_master_category_idx \(category=\?\)/,
    );
    expect(details).not.toMatch(/\bSCAN product_master\b/);
  };

  it('the fully-blocked candidate query is index-bounded', () => {
    expectCategoryIndexPlan({ abvBlocked: true, volumeBlocked: true });
  });

  it('the fully-widened candidate query (category-only) is still index-bounded', () => {
    expectCategoryIndexPlan({ abvBlocked: false, volumeBlocked: false });
  });
});

// ---------------------------------------------------------------------------
// Assembly — normalizedProductFromMasterRow / productMasterRecordFromRow
// ---------------------------------------------------------------------------

const CLEAN_ROW: D1ProductMasterQueryRow = {
  id: 1,
  ean: '6410805001237',
  name: 'Karhu III',
  brand: 'Karhu',
  category: 'beer',
  alcohol_by_volume: 0.047,
  container_type: 'can',
  unit_volume: 0.33,
};

describe('normalizedProductFromMasterRow', () => {
  it('assembles a clean row: percent-scale ABV, canonical category, no warnings', () => {
    const product = normalizedProductFromMasterRow(CLEAN_ROW);
    expect(product.normalizedName).toBe('Karhu III');
    expect(product.normalizedBrand).toBe('Karhu');
    expect(product.canonicalCategory).toBe('beer');
    expect(product.volumeLitres).toBe(0.33);
    expect(product.alcoholByVolume).toBeCloseTo(4.7, 10);
    expect(product.containerType).toBe('metal-can');
    expect(product.ean).toBe('6410805001237');
    expect(product.images).toEqual([]);
    expect(product.description).toBe('');
    expect(product.normalizationWarnings).toEqual([]);
    expect(product.originalInput).toEqual({
      name: 'Karhu III',
      brand: 'Karhu',
      category: 'beer',
      volume: 0.33,
      volumeUnit: 'L',
      abv: product.alcoholByVolume,
      packaging: 'can',
      ean: '6410805001237',
    });
  });

  it('zero volume degrades to 0 with a warning — never a crash', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, unit_volume: 0 });
    expect(product.volumeLitres).toBe(0);
    expect(product.normalizationWarnings.join('\n')).toMatch(/unit volume/i);
  });

  it('null volume degrades to 0 with a warning', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, unit_volume: null });
    expect(product.volumeLitres).toBe(0);
    expect(product.normalizationWarnings.join('\n')).toMatch(/missing/i);
  });

  it('null ABV degrades to 0 with a warning', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, alcohol_by_volume: null });
    expect(product.alcoholByVolume).toBe(0);
    expect(product.normalizationWarnings.join('\n')).toMatch(/alcohol by volume is missing/i);
  });

  it('a percentage-scale ABV straggler is used as-is, flagged with a warning', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, alcohol_by_volume: 4.7 });
    expect(product.alcoholByVolume).toBeCloseTo(4.7, 10);
    expect(product.normalizationWarnings.join('\n')).toMatch(/percentage-scale/);
  });

  it('unknown container type degrades to other with a warning', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, container_type: 'crate' });
    expect(product.containerType).toBe('other');
    expect(product.normalizationWarnings.join('\n')).toMatch(/crate/);
  });

  it('unknown stored category degrades to other with a warning', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, category: 'mead' });
    expect(product.canonicalCategory).toBe('other');
    expect(product.normalizationWarnings.join('\n')).toMatch(/mead/);
  });

  it('null ean passes through as null', () => {
    const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, ean: null });
    expect(product.ean).toBeNull();
    expect(product.originalInput.ean).toBeUndefined();
  });

  it('maps every stored tax key to its canonical representative', () => {
    const expectations: Array<[string, string]> = [
      ['beer', 'beer'],
      ['wine_still', 'wine'],
      ['wine_sparkling', 'sparkling-wine'],
      ['intermediate_products', 'fortified-wine'],
      ['other_fermented', 'cider'],
      ['spirits', 'spirits'],
    ];
    for (const [stored, canonical] of expectations) {
      const product = normalizedProductFromMasterRow({ ...CLEAN_ROW, category: stored });
      expect(product.canonicalCategory, stored).toBe(canonical);
      expect(product.normalizationWarnings, stored).toEqual([]);
    }
  });

  it('the blocking round trip is the identity on all six stored keys', () => {
    for (const stored of [
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]) {
      const canonical = storedCategoryToCanonical(stored);
      expect(canonical, stored).not.toBeNull();
      expect(canonicalCategoryToStored(canonical!), stored).toBe(stored);
    }
  });
});

describe('productMasterRecordFromRow', () => {
  it('mirrors the assembly numerics so seed and candidates share one scale', () => {
    const record = productMasterRecordFromRow(CLEAN_ROW);
    const seed = normalizedProductFromMasterRow(CLEAN_ROW);
    expect(record.alcoholByVolume).toBe(seed.alcoholByVolume);
    expect(record.volumeLitres).toBe(seed.volumeLitres);
    expect(record.canonicalCategory).toBe(seed.canonicalCategory);
    expect(record.normalizedName).toBe(seed.normalizedName);
    expect(record.normalizedBrand).toBe(seed.normalizedBrand);
    expect(record.id).toBe(1);
  });

  it('tolerates the degenerate rows without throwing', () => {
    const record = productMasterRecordFromRow({
      ...CLEAN_ROW,
      alcohol_by_volume: null,
      unit_volume: 0,
      ean: null,
    });
    expect(record.alcoholByVolume).toBe(0);
    expect(record.volumeLitres).toBe(0);
    expect(record.ean).toBeNull();
  });
});

describe('adapter ↔ matcher compatibility', () => {
  it('findCandidates results feed scoreProduct with an assembled seed', async () => {
    const { d1, repo } = makeRepo();
    await seedFixture(d1, FIXTURE);

    // The degenerate row is the point: the pass must be able to score
    // it (name/brand/category only) instead of crashing.
    const degenerateSeed = normalizedProductFromMasterRow({
      id: 99,
      ean: null,
      name: 'Mystery Olut 0,0 l  %',
      brand: 'Brand A',
      category: 'beer',
      alcohol_by_volume: null,
      container_type: 'can',
      unit_volume: 0,
    });
    expect(degenerateSeed.volumeLitres).toBe(0);
    expect(degenerateSeed.alcoholByVolume).toBe(0);

    const candidates = await repo.findCandidates({
      brand: degenerateSeed.normalizedBrand,
      category: degenerateSeed.canonicalCategory,
      volumeLitres: degenerateSeed.volumeLitres,
      abv: degenerateSeed.alcoholByVolume,
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const score = scoreProduct(degenerateSeed, candidate);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

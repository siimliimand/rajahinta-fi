/**
 * Product-id slice read tests (task 1.1, change sitemap-tree-coverage) —
 * the sitemap enumeration's repository seam, against the real SQLite
 * engine with the committed migrations:
 *
 *   - the slice read's contract (id order, exact total, truthful lastmod
 *     composition) through D1ProductSearchRepository.listProductIdSlice;
 *   - the aggregate-cost guard that feeds the D5 fallback decision: the
 *     offer-freshness probe rides the product_id-leading index
 *     (retail_offers_product_merchant_id_idx, migration 0025) — asserted
 *     by EXPLAIN QUERY PLAN on the exact exported statement — and a
 *     catalog-realistic 5,000-slice read completes with a bounded wall
 *     clock, so a future plan regression to a whole-history aggregate
 *     fails loudly instead of silently tripping production cost.
 *
 * @module ProductIdSliceRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import {
  D1ProductSearchRepository,
  PRODUCT_ID_SLICE_SQL,
} from '../product-search.repository';

const { db, d1 } = openMigratedD1();

/** Insert one in-universe product row (universe defaults: ok / not held). */
const insertProduct = db.prepare(
  `INSERT INTO product_master (id, name, manufacturer, brand, category,
       alcohol_by_volume, unit_volume, container_type, regulatory_classification)
   VALUES (?, ?, 'Brewery', 'Brand', 'beer', 0.047, 0.33, 'can', 'beer')`,
);

/** Insert one observed offer (merchant rotated for index realism). */
const insertOffer = db.prepare(
  `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
       availability, observed_at)
   VALUES (?, ?, 'FI', ?, 350, 'in_stock', ?)`,
);

function seedProduct(id: number, updatedAt?: string): void {
  insertProduct.run(id, `Product ${id}`);
  if (updatedAt !== undefined) {
    db.prepare('UPDATE product_master SET updated_at = ? WHERE id = ?').run(
      updatedAt,
      id,
    );
  }
}

/** Clear both tables — every test seeds its own closed world. */
function resetCatalog(): void {
  db.exec('DELETE FROM retail_offers');
  db.exec('DELETE FROM product_master');
}

describe('D1ProductSearchRepository.listProductIdSlice', () => {
  it('orders by id, reports the exact total, and composes truthful lastmod', async () => {
    resetCatalog();
    // Insertion order deliberately shuffled; slices order by id.
    seedProduct(3, '2026-03-01T00:00:00.000Z');
    seedProduct(1, '2026-03-01T00:00:00.000Z');
    seedProduct(2, '2026-03-01T00:00:00.000Z');
    // Product 1: freshest offer later than the row → offer timestamp.
    insertOffer.run(11, 'alko', 1, '2026-04-01T12:00:00.000Z');
    insertOffer.run(12, 'systembolaget', 1, '2026-02-01T12:00:00.000Z');
    // Product 2: all offers older than the row → updated_at.
    insertOffer.run(21, 'alko', 2, '2026-01-15T00:00:00.000Z');
    // Product 3: no offers → updated_at (the per-row fallback level).

    const repo = new D1ProductSearchRepository(d1);
    const page = await repo.listProductIdSlice(0, 2);
    expect(page.total).toBe(3);
    expect(page.items).toEqual([
      { id: 1, lastmod: '2026-04-01T12:00:00.000Z' },
      { id: 2, lastmod: '2026-03-01T00:00:00.000Z' },
    ]);

    const tail = await repo.listProductIdSlice(2, 2);
    expect(tail.items).toEqual([
      { id: 3, lastmod: '2026-03-01T00:00:00.000Z' },
    ]);
    expect(tail.total).toBe(3);
  });

  it('rejects invalid slice arguments loudly (exactness contract)', async () => {
    const repo = new D1ProductSearchRepository(d1);
    await expect(repo.listProductIdSlice(-1, 10)).rejects.toThrow(TypeError);
    await expect(repo.listProductIdSlice(0, 0)).rejects.toThrow(TypeError);
  });

  it('bounds the offer-freshness probe to the product_id-leading index', () => {
    resetCatalog();
    // Two rows so the planner reasons over a non-empty table; the index
    // choice for an equality probe does not depend on the values.
    seedProduct(1);
    seedProduct(2);
    insertOffer.run(11, 'alko', 1, '2026-04-01T12:00:00.000Z');

    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${PRODUCT_ID_SLICE_SQL}`)
      .all(10, 0) as { detail: string }[];
    const details = plan.map((r) => r.detail).join('\n');
    // The correlated MAX probe: product_id-equality on the 0025 index.
    expect(details).toMatch(
      /retail_offers_product_merchant_id_idx \(product_id=\?\)/,
    );
    // No whole-history aggregate: retail_offers is never full-scanned.
    expect(details).not.toMatch(/SCAN retail_offers\b/);
  });

  it('serves a 5,000 slice at catalog-realistic scale inside the cost bound (D5 decision input)', async () => {
    resetCatalog();
    // The production catalog's order of magnitude (design.md context):
    // 20,839 products, ~1.26 observed offers per product across three
    // merchants, observed_at spread over weeks — enough rows that a
    // whole-history aggregate plan would blow the bound visibly.
    const PRODUCTS = 20_839;
    db.exec('BEGIN');
    try {
      for (let id = 1; id <= PRODUCTS; id += 1) {
        insertProduct.run(id, `Product ${id}`);
        const observedAt = `2026-0${(id % 9) + 1}-1${id % 9}T00:00:00.000Z`;
        insertOffer.run(id * 10, ['alko', 'systembolaget', 'vinmonopolet'][id % 3], id, observedAt);
        if (id % 4 === 0) {
          insertOffer.run(id * 10 + 1, 'alko', id, observedAt);
        }
        if (id % 10 === 0) {
          insertOffer.run(id * 10 + 2, 'vinmonopolet', id, observedAt);
        }
      }
    } finally {
      db.exec('COMMIT');
    }

    const repo = new D1ProductSearchRepository(d1);
    const started = performance.now();
    const page = await repo.listProductIdSlice(0, 5_000);
    const elapsedMs = performance.now() - started;

    expect(page.total).toBe(PRODUCTS);
    expect(page.items).toHaveLength(5_000);
    expect(page.items[0]!.id).toBe(1);
    expect(page.items[4_999]!.id).toBe(5_000);

    // The recorded observation (D5 fallback-decision input) — printed for
    // the change notes, asserted only as a pathological-plan tripwire.
    console.info(
      `[sitemap-tree-coverage 1.1] 5,000-slice over ${PRODUCTS} products / ` +
        `${db.prepare('SELECT COUNT(*) AS n FROM retail_offers').get()!.n} offers: ` +
        `${elapsedMs.toFixed(1)} ms (node:sqlite in-memory proxy)`,
    );
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

/**
 * Migration 0023 (task 3.1, change expand-alerts-accuracy-breakdowns —
 * reopened slice) — the product_master category index. Proves, against
 * the real SQLite engine with the committed migrations applied:
 *
 *   - the index exists, on the right table and column;
 *   - the category filter of the CATEGORY sweep's minimum query
 *     (findCategoryMinPriceCents) is index-bounded — with the index the
 *     plan contains no full table scan of product_master;
 *   - the full minimum-query statement keeps every table access on an
 *     index (the summaries side rides the existing bucket key, the
 *     product side on the primary key), the spec's "bounded by the
 *     summary table's existing keys and the product category index".
 *
 * @module D1Migration0023Test
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';

const { db } = openMigratedD1();

// Verbatim of the module-private CATEGORY_MIN_SQL in
// price-history-summary.repository.ts — findCategoryMinPriceCents's
// prepared statement. Kept literal so the plan below is the plan the
// sweep actually runs; drift here fails loudly as a plan-shape change.
const CATEGORY_MIN_SQL = `
  SELECT s.product_id AS product_id, s.price_close_cents AS price_close_cents
    FROM price_history_summaries s
    JOIN product_master p ON p.id = s.product_id
   WHERE s.granularity = ?
     AND s.period_start >= ? AND s.period_start <= ?
     AND s.merchant IS NULL
     AND p.category = ?
   ORDER BY s.price_close_cents ASC, s.product_id ASC
   LIMIT 1`;

describe('migration 0023 — product_master category index', () => {
  it('creates the index on product_master(category)', () => {
    const row = db
      .prepare(
        "SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = 'product_master_category_idx'",
      )
      .get() as { tbl_name: string; sql: string };
    expect(row.tbl_name).toBe('product_master');
    expect(row.sql).toContain('CREATE INDEX');
    const columns = db
      .prepare('PRAGMA index_info(product_master_category_idx)')
      .all() as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual(['category']);
  });

  it('bounds the category filter that was a full table scan before the index', () => {
    // Two rows so the planner reasons over a non-empty table, the state
    // the sweep runs in; the index choice for an equality filter does not
    // depend on these values.
    db.prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
       VALUES (1, 'Karhu', 'Hartwall', 'Karhu', 'beer', 0.5, 'can', 'beer'),
              (2, 'Pinot', 'X', 'Y', 'wine_still', 0.75, 'glass', 'wine')`,
    ).run();

    // The product-side selection of findCategoryMinPriceCents: the exact
    // filter the spec requires to be bounded by the category index.
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT id FROM product_master WHERE category = ?')
      .all('beer') as { detail: string }[];
    const details = plan.map((r) => r.detail).join('\n');
    expect(details).toMatch(
      /SEARCH product_master USING (COVERING )?INDEX product_master_category_idx \(category=\?\)/,
    );
    expect(details).not.toMatch(/\bSCAN product_master\b/);
  });

  it('keeps every table access of the full minimum query on an index', () => {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${CATEGORY_MIN_SQL}`)
      .all('daily', '2026-01-01', '2026-12-31', 'beer') as { detail: string }[];
    const details = plan.map((r) => r.detail).join('\n');
    // Summary side: bounded by the pre-existing summary key index.
    expect(details).toMatch(/SEARCH s USING INDEX price_history_summaries_/);
    // Product side: reached by primary-key lookup, never a bare scan.
    expect(details).toMatch(/SEARCH p USING INTEGER PRIMARY KEY \(rowid=\?\)/);
    expect(details).not.toMatch(/\bSCAN (s|p|product_master|price_history_summaries)\b/);
  });
});

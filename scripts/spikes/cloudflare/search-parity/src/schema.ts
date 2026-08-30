/**
 * G2 search parity spike — SQLite/D1 schema.
 *
 * Mirrors the searchable columns of `productMaster`
 * (packages/data-platform/src/schema.ts) plus an FTS5 external-content
 * virtual table with sync triggers — the translation task 2.2 would ship.
 *
 * D1 is SQLite: the same DDL runs on better-sqlite3 here and on
 * `wrangler d1 execute` / D1 in production (D1 supports FTS5).
 *
 * @module G2SpikeSchema
 */

/** Product master subset — searchable columns + the audit columns the
 *  search contract touches. pg `numeric` columns stay decimal TEXT
 *  (parity with the Drizzle `string` mapping); timestamps ISO-8601 TEXT. */
export const CREATE_PRODUCT = `
CREATE TABLE product (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  alcohol_by_volume TEXT,
  unit_volume TEXT NOT NULL,
  container_type TEXT NOT NULL,
  regulatory_classification TEXT NOT NULL,
  deposit_system_status INTEGER,
  ean TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/** External-content FTS5 index over the three searched fields. The pg
 *  side searches name/brand/manufacturer via ILIKE + pg_trgm similarity
 *  (DrizzleProductRepository.searchRanked); this is the FTS5 equivalent.
 *  remove_diacritics 0 keeps ö/ä/å as-is so 'öl' does not acquire the
 *  extra recall of 'ol*' — parity with ILIKE, which folds case but never
 *  strips diacritics. */
export const CREATE_PRODUCT_FTS = `
CREATE VIRTUAL TABLE product_fts USING fts5(
  name,
  brand,
  manufacturer,
  content='product',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 0'
)`;

/** External-content tables must be kept in sync by triggers — these are
 *  the exact trigger shapes task 2.2 would create on D1. */
export const TRIGGERS = [
  `CREATE TRIGGER product_fts_ai AFTER INSERT ON product BEGIN
    INSERT INTO product_fts(rowid, name, brand, manufacturer)
    VALUES (new.id, new.name, new.brand, new.manufacturer);
  END`,
  `CREATE TRIGGER product_fts_ad AFTER DELETE ON product BEGIN
    INSERT INTO product_fts(product_fts, rowid, name, brand, manufacturer)
    VALUES ('delete', old.id, old.name, old.brand, old.manufacturer);
  END`,
  `CREATE TRIGGER product_fts_au AFTER UPDATE ON product BEGIN
    INSERT INTO product_fts(product_fts, rowid, name, brand, manufacturer)
    VALUES ('delete', old.id, old.name, old.brand, old.manufacturer);
    INSERT INTO product_fts(rowid, name, brand, manufacturer)
    VALUES (new.id, new.name, new.brand, new.manufacturer);
  END`,
];

/** Create the full schema on a database handle. */
export function createSchema(db: { exec: (sql: string) => unknown }): void {
  db.exec(CREATE_PRODUCT);
  db.exec(CREATE_PRODUCT_FTS);
  for (const t of TRIGGERS) db.exec(t);
}

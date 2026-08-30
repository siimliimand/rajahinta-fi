/**
 * Migration 0002 (gate-review addition (a), task 2.5) — the widened
 * product_master.container_type CHECK. Proves, against the real SQLite
 * engine with the committed migrations applied:
 *
 *   - the authoritative value set (core-domain ContainerType union ∪
 *     fixture values: glass, plastic, metal, carton, other, can, bottle)
 *     inserts cleanly;
 *   - values outside the set are rejected;
 *   - a rebuild over a POPULATED database preserves rows and the child
 *     reference graph (retail_offers, calculation_records FKs);
 *   - the FTS5 sync triggers survive the rebuild and the external-content
 *     index stays consistent with the copied rowids;
 *   - the stored CHECK constraint ends up textually canonical.
 *
 * @module D1Migration0002Test
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openMigratedD1 } from './d1-test-harness';

const { db, d1 } = openMigratedD1();

function seedProduct(id: number, containerType: string): void {
  db.prepare(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
     VALUES (?, ?, 'Hartwall', 'Karhu', 'beer', 0.5, ?, 'beer')`,
  ).run(id, `product-${id}`, containerType);
}

describe('migration 0002 — container_type CHECK value set', () => {
  it('accepts the full core-domain ContainerType union', () => {
    const coreDomainUnion = ['glass', 'plastic', 'metal', 'carton', 'other'];
    coreDomainUnion.forEach((containerType, i) => {
      expect(() => seedProduct(10 + i, containerType)).not.toThrow();
    });
  });

  it('accepts the fixture/feed spellings can and bottle (golden products, container-duty standard packaging)', () => {
    expect(() => seedProduct(20, 'can')).not.toThrow();
    expect(() => seedProduct(21, 'bottle')).not.toThrow();
  });

  it('rejects values outside the authoritative set', () => {
    // The normalization-canonical kebab spellings are NOT product-master
    // storage values (CanonicalContainerType ≠ ContainerType).
    expect(() => seedProduct(30, 'metal-can')).toThrow(/CHECK constraint failed/);
    expect(() => seedProduct(31, 'keg')).toThrow(/CHECK constraint failed/);
    expect(() => seedProduct(32, 'glass-bottle')).toThrow(/CHECK constraint failed/);
    expect(() => seedProduct(33, 'unknown')).toThrow(/CHECK constraint failed/);
  });

  it('stores the CHECK constraint textually canonical (the rename rewrote the self-reference)', () => {
    const table = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_master'")
      .get() as { sql: string };
    expect(table.sql).not.toContain('product_master_new');
    expect(table.sql).toContain(
      `"product_master"."container_type" IN ('glass', 'plastic', 'metal', 'carton', 'other', 'can', 'bottle')`,
    );
  });

  it('leaves FK enforcement on — the migration restores the D1 default', () => {
    const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(fk.foreign_keys).toBe(1);
  });
});

describe('migration 0002 — rebuild over a populated database', () => {
  // Simulates applying 0002 to an environment that already ran 0000+0001
  // and carries products, referencing offers, and calculation records.
  const populated = new DatabaseSync(':memory:');
  const migrationsDir = path.resolve(
    process.cwd(),
    'src/d1/migrations',
  );
  const apply = (target: DatabaseSync, files: string[]): void => {
    for (const file of files) {
      for (const statement of readFileSync(path.join(migrationsDir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean)) {
        target.exec(statement);
      }
    }
  };

  const baseMigrations = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => f !== '0002_product_container_type_check.sql')
    .sort();

  apply(populated, baseMigrations);
  // Seed with values the ORIGINAL 0000 CHECK accepts ('can' only becomes
  // legal once 0002 has rebuilt the table).
  populated.exec(
    `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification, deposit_system_status, ean)
     VALUES (1, 'Karhu IV', 'Hartwall', 'Karhu', 'beer', 0.5, 'glass', 'beer', 1, '6410805001117'),
            (2, 'Penfold Wine', 'Penfolds', 'Penfold', 'wine', 0.75, 'glass', 'wine', 0, NULL)`,
  );
  populated.exec(
    `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents, observed_at, reliability_status)
     VALUES (1, 'alko', 'FI', 1, 291, '2026-08-01T00:00:00.000Z', 'VERIFIED')`,
  );
  populated.exec(
    `INSERT INTO calculation_records (id, product_master_id, total_cents, breakdown, confidence, quantity, destination, disclaimer, session_id, calculated_at)
     VALUES (1, 1, 500, '{}', 'HIGH', 1, 'FI', 'd', 'sess-1', '2026-08-01T00:00:00.000Z')`,
  );
  // FTS index has content for both products at this point.
  apply(populated, ['0002_product_container_type_check.sql']);

  it('preserves the product rows verbatim — ids included', () => {
    const rows = populated
      .prepare('SELECT id, container_type, ean, deposit_system_status FROM product_master ORDER BY id')
      .all() as { id: number; container_type: string; ean: string | null; deposit_system_status: number }[];
    expect(rows).toEqual([
      { id: 1, container_type: 'glass', ean: '6410805001117', deposit_system_status: 1 },
      { id: 2, container_type: 'glass', ean: null, deposit_system_status: 0 },
    ]);
  });

  it('keeps the child reference graph intact', () => {
    const violations = populated.prepare('PRAGMA foreign_key_check').all();
    expect(violations).toEqual([]);

    const offer = populated
      .prepare('SELECT count(*) AS n FROM retail_offers WHERE product_id = 1')
      .get() as { n: number };
    expect(offer.n).toBe(1);
  });

  it('keeps the FTS5 external-content index consistent with the copied rowids', () => {
    const matches = populated
      .prepare(
        `SELECT p.id FROM product_master_fts f
          JOIN product_master p ON p.id = f.rowid
         WHERE product_master_fts MATCH '"karhu" *'`,
      )
      .all() as { id: number }[];
    expect(matches).toEqual([{ id: 1 }]);

    // The triggers were recreated: a fresh insert lands in the index too.
    populated.exec(
      `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
       VALUES (3, 'Karjala IV', 'Hartwall', 'Karjala', 'beer', 0.5, 'can', 'beer')`,
    );
    const afterInsert = populated
      .prepare(
        `SELECT p.name FROM product_master_fts f
          JOIN product_master p ON p.id = f.rowid
         WHERE product_master_fts MATCH '"karjala" *'`,
      )
      .all() as { name: string }[];
    expect(afterInsert).toEqual([{ name: 'Karjala IV' }]);

    // UPDATE rewrites the old FTS content ('delete' + reinsert semantics):
    // the replaced token 'iv' is gone, the new token 'tupla' is indexed.
    populated.exec("UPDATE product_master SET name = 'Karjala Tupla' WHERE id = 3");
    const afterUpdate = populated
      .prepare(
        `SELECT p.name FROM product_master_fts f
          JOIN product_master p ON p.id = f.rowid
         WHERE product_master_fts MATCH '"tupla" *'`,
      )
      .all() as { name: string }[];
    expect(afterUpdate).toEqual([{ name: 'Karjala Tupla' }]);
    const oldTokenGone = populated
      .prepare(
        `SELECT count(*) AS n FROM product_master_fts f
          JOIN product_master p ON p.id = f.rowid
         WHERE product_master_fts MATCH '"iv" *' AND p.id = 3`,
      )
      .get() as { n: number };
    expect(oldTokenGone.n).toBe(0);
  });

  it('enforces the widened CHECK on the rebuilt table', () => {
    expect(() =>
      populated.exec(
        `INSERT INTO product_master (id, name, manufacturer, brand, category, unit_volume, container_type, regulatory_classification)
         VALUES (4, 'X', 'Y', 'Z', 'beer', 0.33, 'tölkki', 'beer')`,
      ),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('migration 0002 — the D1 repositories run against the migrated schema', () => {
  it('still serves the FTS-ranked search path (no regression from the rebuild)', async () => {
    seedProduct(40, 'can');
    d1
      .prepare("UPDATE product_master SET name = 'Karhu CAN Special' WHERE id = 40")
      .run();

    const hits = db
      .prepare(
        `SELECT p.id FROM product_master_fts f
          JOIN product_master p ON p.id = f.rowid
         WHERE product_master_fts MATCH '"special" *'`,
      )
      .all() as { id: number }[];
    expect(hits).toEqual([{ id: 40 }]);
  });
});

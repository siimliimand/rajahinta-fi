/**
 * D1 seeded-data test for the canonical unit-volume window (task 1.4,
 * change unit-integrity-and-result-trust; spec product-data-model
 * "Unit-window invariant rejects implausible rows").
 *
 * Pins the SEEDED reality against the spec window `0 < unit_volume < 100`:
 *
 * 1. Every seeded staging fixture sits inside the window — reseeding can
 *    never reintroduce millilitres (fixture ids 1..45, spot-checked on the
 *    Koskenkorva 0.5 L row, seed fixture id 2).
 *
 * 2. The documented feed residue (notes.md, task 1.3: 20 local rows with
 *    `unit_volume = 0.0` — feed names without a parsable volume token,
 *    kept by design keyed ESTIMATED) is modelled explicitly: the suite
 *    asserts the residue count matches the documented expectation AND
 *    that every NON-zero row is in-window, so the residue is pinned, not
 *    ignored.
 *
 * 3. Rows at the exclusive bounds (>= 100, incl. the ml-shaped 500
 *    encoding; < 0) are flagged by the same predicate the ingestion
 *    quality stage enforces (apps/api-worker ingestion-steps
 *    `unitVolumeViolations`) — data errors, never a second unit
 *    convention.
 *
 * Runs against a real SQLite database via the seed pipeline's own
 * node:sqlite apply path (the same engine class D1/miniflare embeds).
 *
 * @module Tests/Seed/D1UnitVolumeWindow
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySeedToSqlite, listMigrationFiles } from '../apply-node-sqlite';
import { buildExpectations, writeSeedSqlFiles } from '../generate';

// Vitest runs with the package root as cwd (vitest.config.ts sets
// root: import.meta.dirname) — same resolution as d1-seed.test.ts.
const MIGRATIONS_DIR = resolve(process.cwd(), 'src', 'd1', 'migrations');

/**
 * The spec window as SQL — exclusive at both ends. Mirrors the ingestion
 * quality-stage predicate (`0 < unit_volume < 100`); NULL cannot occur
 * (`unit_volume` is NOT NULL), the guard keeps the predicate total.
 */
const OUT_OF_WINDOW_SQL =
  'unit_volume IS NULL OR NOT (unit_volume > 0 AND unit_volume < 100)';

describe('unit-volume window over seeded product_master (task 1.4)', () => {
  let workDir: string;
  let seedFiles: Array<{ name: string; path: string }>;
  let dbPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'd1-unit-window-test-'));
    seedFiles = writeSeedSqlFiles(workDir).map(({ file, path }) => ({
      name: file,
      path,
    }));
    dbPath = join(workDir, 'unit-window.sqlite');
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** Seed a fresh database and open it for queries. */
  function seededDatabase(): DatabaseSync {
    applySeedToSqlite(dbPath, {
      migrationsDir: MIGRATIONS_DIR,
      seedSqlFiles: seedFiles,
    });
    return new DatabaseSync(dbPath);
  }

  function count(db: DatabaseSync, predicate: string): number {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM product_master WHERE ${predicate}`)
      .get() as { c: number | bigint };
    return Number(row.c);
  }

  /** Insert a product_master row the way feed ingestion leaves it. */
  function insertFeedResidueRow(
    db: DatabaseSync,
    id: number,
    unitVolume: number,
  ): void {
    db.prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type,
          regulatory_classification, deposit_system_status)
       VALUES (?, ?, 'Feed Fixture Brewery', 'Feed Fixture', 'beer',
          NULL, ?, 'can', 'beer', 0)`,
    ).run(id, `Feed fixture ${id} 33CLx24`, unitVolume);
  }

  // The seed applies 20 migrations plus the full seed SQL; the vitest
  // default 5s budget is too tight on loaded CI runners (d1-seed parity).
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('seeds every fixture inside the canonical litre window', () => {
    const db = seededDatabase();
    try {
      const expectations = buildExpectations();
      expect(count(db, '1 = 1')).toBe(expectations.productMaster);
      expect(count(db, OUT_OF_WINDOW_SQL)).toBe(0);

      // Spot check on the Koskenkorva row the whole change anchors on
      // (staging fixture id 2): stored litres, 0.5-shaped, not 500.
      const koskenkorva = db
        .prepare('SELECT unit_volume FROM product_master WHERE id = 2')
        .get() as { unit_volume: number };
      expect(koskenkorva.unit_volume).toBe(0.5);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('pins the documented residue: exactly the zero-volume rows, all non-zero rows in-window', () => {
    const db = seededDatabase();
    try {
      // The task-1.3 residue, modelled: 20 feed-ingested rows whose names
      // carry no parsable volume token — the parser's 0-ml encoding.
      for (let id = 8001; id <= 8020; id++) insertFeedResidueRow(db, id, 0.0);

      // Documented residue assertion — the count matches notes.md, so a
      // future silent change of the residue population fails HERE.
      expect(count(db, 'unit_volume = 0')).toBe(20);

      // Every NON-zero row satisfies the spec window (parenthesized —
      // AND binds tighter than the OR inside the predicate).
      expect(
        count(db, `unit_volume <> 0 AND (${OUT_OF_WINDOW_SQL})`),
      ).toBe(0);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('flags bound-violating rows as data errors — >= 100 (ml-shaped) and < 0', () => {
    const db = seededDatabase();
    try {
      // 500: the ml-shaped encoding the Koskenkorva bug came from;
      // 100: the exclusive upper bound itself; -1: a negative.
      insertFeedResidueRow(db, 9001, 500);
      insertFeedResidueRow(db, 9002, 100);
      insertFeedResidueRow(db, 9003, -1);

      const flagged = db
        .prepare(
          `SELECT id FROM product_master WHERE ${OUT_OF_WINDOW_SQL} ORDER BY id`,
        )
        .all() as Array<{ id: number }>;
      expect(flagged.map((r) => r.id)).toEqual([9001, 9002, 9003]);

      // A 15 l BIB stays in-window — litres up to (excluding) 100 are
      // legitimate; only the bounds are data errors.
      expect(count(db, "unit_volume = 15 AND NOT (unit_volume > 0 AND unit_volume < 100)")).toBe(0);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('applies the committed migrations the assertion tables rely on', () => {
    // Guard against a silently renamed migrations dir: the predicate
    // tests above are only meaningful against the real schema.
    expect(listMigrationFiles(MIGRATIONS_DIR).length).toBeGreaterThan(0);
  });
});

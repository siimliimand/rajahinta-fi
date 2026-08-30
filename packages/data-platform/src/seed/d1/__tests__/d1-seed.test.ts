/**
 * Tests for the D1 seed pipeline (task 2.6, change migrate-to-cloudflare).
 *
 * Covers the two properties the seed pipeline's correctness rests on:
 *
 * 1. Determinism — the generated SQL is a pure function of SEED_RULES +
 *    the staging fixtures (no wall-clock, no randomness), so regeneration
 *    is diff-able and the sha256 fingerprints logged by the orchestrator
 *    are stable.
 *
 * 2. Idempotency — applying the seed to a real SQLite database (node:sqlite,
 *    the same engine class D1/miniflare embed) twice produces identical,
 *    expected state: version-guarded inserts skip present tax-rule labels
 *    without repairing them, INSERT OR IGNORE fixtures conflict on their
 *    explicit primary keys, and the verification query asserts exact row
 *    counts, per-version presence, and a value spot check.
 *
 * The tamper scenario pins the append-only dataset policy: a pre-existing
 * (drifted) version label blocks its whole version and makes verification
 * FAIL — existing rows are never silently repaired or duplicated.
 *
 * @module Tests/Seed/D1
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SeedVerificationError,
  buildExpectations,
  generateSeedSqlFiles,
  generateStagingSql,
  generateTaxRulesSql,
  writeSeedSqlFiles,
} from '../generate';
import { applySeedAndVerify, applySeedToSqlite, listMigrationFiles } from '../apply-node-sqlite';

// ---------------------------------------------------------------------------
// Fixtures — migrations dir of this package, and a scratch dir per test
// ---------------------------------------------------------------------------

// Vitest runs with the package root as cwd (vitest.config.ts sets
// root: import.meta.dirname), and tsc's commonjs module setting rules out
// import.meta here — resolve from the package root instead.
const MIGRATIONS_DIR = resolve(process.cwd(), 'src', 'd1', 'migrations');

describe('D1 seed SQL generation (task 2.6)', () => {
  it('is byte-deterministic across runs', () => {
    const first = generateSeedSqlFiles();
    const second = generateSeedSqlFiles();
    expect(second.map((f) => f.name)).toEqual(first.map((f) => f.name));
    for (let i = 0; i < first.length; i++) {
      expect(second[i].sql).toBe(first[i].sql);
    }
  });

  it('carries no wall-clock generation stamps', () => {
    for (const { sql } of generateSeedFilesSafe()) {
      // Effective-dating timestamps ARE present by design; a generation
      // timestamp in a header comment is not.
      expect(sql).not.toMatch(/Generated: \d{4}-\d{2}-\d{2}/);
    }
  });

  it('guards each tax-rule version label with a whole-version NOT EXISTS', () => {
    const sql = generateTaxRulesSql();
    for (const label of Object.keys(buildExpectations().taxRulesPerVersion)) {
      expect(sql).toContain(
        `SELECT 1 FROM "tax_rules" WHERE "version_label" = '${label}'`,
      );
    }
  });

  it('emits explicit deterministic ids for every tax rule row', () => {
    const sql = generateTaxRulesSql();
    const valueRows = sql.match(/^\s+\(\d+, '(?:excise|container_duty)'/gm) ?? [];
    expect(valueRows).toHaveLength(buildExpectations().taxRulesTotal);
  });

  it('emits INSERT OR IGNORE with explicit ids for every staging table', () => {
    const sql = generateStagingSql();
    const statements = sql.match(/INSERT OR IGNORE INTO "[a-z_]+"/g) ?? [];
    expect(statements).toHaveLength(4); // transport_offers, product_master, retail_offers, staging_reviews
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "staging_reviews"');
  });

  it('derives physical column names from the D1 schema tables', () => {
    const [taxFile, stagingFile] = generateSeedFilesSafe();
    // If these came from anywhere but getTableColumns(d1 schema), a schema
    // rename would not break generation — this pins the derivation.
    expect(taxFile.sql).toContain('"tax_type", "product_category", "rate"');
    expect(taxFile.sql).toContain('"version_label"');
    expect(stagingFile.sql).toContain('"seller_involvement_indicator"');
    expect(stagingFile.sql).toContain('"regulatory_classification"');
  });

  it('normalizes only the fixture values outside the closed CHECK sets', () => {
    const staging = generateStagingSql();
    // Scope to the product_master block: 'box' is a legitimate
    // transport_offers package_tier and must stay.
    const productBlock = staging.slice(
      staging.indexOf('-- 2. Product master'),
      staging.indexOf('-- 3. Retail offers'),
    );
    // Migration 0002 value set admits 'bottle'/'can' verbatim…
    expect(productBlock).toContain("'bottle'");
    expect(productBlock).toContain("'can'");
    // …while 'box'/'pouch' have no member to map to.
    expect(productBlock).not.toContain("'box'");
    expect(productBlock).not.toContain("'pouch'");
    // 'EXACT' is not in the reliability value set of any seeded table.
    expect(staging).not.toContain("'EXACT'");
  });
});

// ---------------------------------------------------------------------------
// Apply + verify against a real SQLite database (node:sqlite)
// ---------------------------------------------------------------------------

describe('D1 seed apply + verify (node:sqlite)', () => {
  let workDir: string;
  let seedFiles: Array<{ name: string; path: string }>;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'd1-seed-test-'));
    seedFiles = writeSeedSqlFiles(workDir).map(({ file, path }) => ({ name: file, path }));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function freshDatabasePath(): string {
    return join(workDir, 'seed-test.sqlite');
  }

  it('applies migrations then seed to a fresh database and verification passes', () => {
    const result = applySeedToSqlite(freshDatabasePath(), {
      migrationsDir: MIGRATIONS_DIR,
      seedSqlFiles: seedFiles,
    });

    expect(result.migrationsApplied).toEqual(listMigrationFiles(MIGRATIONS_DIR));
    expect(result.seedFilesApplied).toEqual(['tax-rules.d1.sql', 'staging.d1.sql']);

    const expectations = buildExpectations();
    expect(result.verification['tax_rules_total']).toBe(expectations.taxRulesTotal);
    expect(result.verification['product_master_total']).toBe(expectations.productMaster);
    expect(result.verification['retail_offers_total']).toBe(expectations.retailOffers);
    expect(result.verification['transport_offers_total']).toBe(expectations.transportOffers);
    expect(result.verification['staging_reviews_total']).toBe(expectations.stagingReviews);
    expect(result.verification['spot_beer_rate_rows']).toBe(1);
  });

  it('is idempotent: re-applying the seed never duplicates or changes counts', () => {
    const dbPath = freshDatabasePath();
    const first = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });
    const second = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    // Schema already present → migrations skipped, seed re-applied anyway.
    expect(second.migrationsApplied).toEqual([]);
    expect(second.verification).toEqual(first.verification);
  });

  it('verifies version presence per label, not just the total', () => {
    const dbPath = freshDatabasePath();
    const result = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    const db = new DatabaseSync(dbPath);
    try {
      const expected = buildExpectations();
      for (const [label, count] of Object.entries(expected.taxRulesPerVersion)) {
        const row = db
          .prepare('SELECT COUNT(*) AS c FROM tax_rules WHERE version_label = ?')
          .get(label) as { c: number };
        expect(Number(row.c)).toBe(count);
        expect(result.verification[`tax_rules_${label.replace(/[^A-Za-z0-9]/g, '_')}`]).toBe(count);
      }
    } finally {
      db.close();
    }
  });

  it('fails loudly when a drifted version label is present (append-only: no repair)', () => {
    const dbPath = freshDatabasePath();
    applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    // Simulate drift: a hand-inserted extra row under an existing label.
    const db = new DatabaseSync(dbPath);
    db.exec(
      `INSERT INTO tax_rules (id, tax_type, product_category, rate, effective_from, exemption_conditions, calculation_formula_reference, official_source, version_label)
       VALUES (9999, 'excise', 'beer', 99.99, '2024-01-01', NULL, 'PER_CENTILITRE_ETHANOL', 'drift-test', 'v1.0-2024')`,
    );
    db.close();

    // The whole-version guard skips the drifted label (never repairs), and
    // the per-version count assertion turns the drift into a LOUD failure.
    expect(() =>
      applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles }),
    ).toThrow(SeedVerificationError);
  });

  it('fails loudly when staging rows are missing from the seeded database', () => {
    const db = new DatabaseSync(':memory:');
    for (const file of listMigrationFiles(MIGRATIONS_DIR)) {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
    // Tax file only — the verification query references the staging tables
    // and must fail rather than pass a partial seed.
    expect(() =>
      applySeedAndVerify(db, seedFiles.filter((f) => f.name === 'tax-rules.d1.sql')),
    ).toThrow();
    db.close();
  });
});

/** Local helper so each generation test re-generates independently. */
function generateSeedFilesSafe(): Array<{ name: string; sql: string }> {
  return generateSeedSqlFiles();
}

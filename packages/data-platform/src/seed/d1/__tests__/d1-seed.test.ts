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
 *    explicit primary keys, the merchant registry upserts on its merchant_id
 *    natural key (immune to operator-row PK collisions), and the
 *    verification query asserts exact row counts, per-version presence, and
 *    a value spot check.
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
  assertVerificationRow,
  buildExpectations,
  buildVerifySql,
  generateSeedSqlFiles,
  generateSourceGovernanceSql,
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

  it('emits INSERT OR IGNORE with explicit ids for the fixture staging tables', () => {
    const sql = generateStagingSql();
    const statements = sql.match(/INSERT OR IGNORE INTO "[a-z_]+"/g) ?? [];
    expect(statements).toHaveLength(4); // transport_offers, product_master, retail_offers, staging_reviews
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "staging_reviews"');
  });

  it('upserts the merchant registry by natural key (operator-row PK collisions cannot swallow bootstrap rows)', () => {
    // Staging deploy 37614170668: the old emission assigned explicit ids by
    // array position under INSERT OR IGNORE, so an operator-added registry
    // row occupying that id (longero, id 3) silently swallowed the araxes
    // bootstrap row. The natural-key upsert makes that failure mode
    // structurally impossible — pin its shape.
    const sql = generateStagingSql();
    expect(sql).toContain('ON CONFLICT ("merchant_id")');
    const statementStart = sql.indexOf('INSERT INTO "merchant_registry"');
    const statementEnd = sql.indexOf('-- 2. Transport offers');
    expect(statementStart).toBeGreaterThan(-1);
    expect(statementEnd).toBeGreaterThan(statementStart);
    const merchantStatement = sql.slice(statementStart, statementEnd);
    // No explicit id column — ids are autoassigned, so a pre-existing row's
    // PK can never conflict with a bootstrap insert.
    expect(merchantStatement).not.toMatch(/"id"/);
    // Seed-owned refresh mirrors seedMerchantRegistry's set clause;
    // carrier_id and created_at are never touched.
    expect(merchantStatement).toContain('"updated_at"');
    expect(merchantStatement).not.toContain('"carrier_id"');
    expect(merchantStatement).not.toContain('"created_at"');
  });

  it('seeds the merchant registry alko-only (removed merchant never re-seeded)', () => {
    const sql = generateStagingSql();
    expect(sql).toContain("('alko', 'Alko'");
    expect(sql).not.toContain('systembolaget');
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
      staging.indexOf('-- 3. Product master'),
      staging.indexOf('-- 4. Retail offers'),
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

  // The seed applies 20 migrations plus the full seed SQL; the vitest
  // default 5s budget is too tight on loaded CI runners.
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('applies migrations then seed to a fresh database and verification passes', () => {
    const result = applySeedToSqlite(freshDatabasePath(), {
      migrationsDir: MIGRATIONS_DIR,
      seedSqlFiles: seedFiles,
    });

    expect(result.migrationsApplied).toEqual(listMigrationFiles(MIGRATIONS_DIR));
    expect(result.seedFilesApplied).toEqual([
      'tax-rules.d1.sql',
      'staging.d1.sql',
      'source-governance.d1.sql',
      'consumption-norms.d1.sql',
      'carrier-box-types.d1.sql',
    ]);

    const expectations = buildExpectations();
    expect(result.verification['tax_rules_total']).toBe(expectations.taxRulesTotal);
    for (const [merchantId, count] of Object.entries(expectations.merchantRegistryRows)) {
      expect(result.verification[`merchant_registry_${merchantId.replace(/[^A-Za-z0-9]/g, '_')}`]).toBe(count);
    }
    expect(result.verification['product_master_total']).toBe(expectations.productMaster);
    expect(result.verification['retail_offers_total']).toBe(expectations.retailOffers);
    expect(result.verification['transport_offers_total']).toBe(expectations.transportOffers);
    expect(result.verification['staging_reviews_total']).toBe(expectations.stagingReviews);
    expect(result.verification['spot_beer_rate_rows']).toBe(1);
    expect(result.verification['consumption_norms_total']).toBe(expectations.consumptionNormsRows);
    expect(result.verification['carrier_box_types_total']).toBe(expectations.carrierBoxTypesRows);
  }, DB_TEST_TIMEOUT_MS);

  it('is idempotent: re-applying the seed never duplicates or changes counts', () => {
    const dbPath = freshDatabasePath();
    const first = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });
    const second = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    // Schema already present → migrations skipped, seed re-applied anyway.
    expect(second.migrationsApplied).toEqual([]);
    expect(second.verification).toEqual(first.verification);
  }, DB_TEST_TIMEOUT_MS);

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
  }, DB_TEST_TIMEOUT_MS);

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
  }, DB_TEST_TIMEOUT_MS);

  it('tolerates operator-added merchant registry rows (ops-path onboarding)', () => {
    // The longero 4.2 / kippis 4.2 precedent: merchants onboarded through
    // the documented ops path grow merchant_registry past the seed set.
    // The gate verifies seeded-row PRESENCE, so an operator row must not
    // fail verification (the old exact-total gate broke every deploy
    // after such an onboarding).
    const dbPath = freshDatabasePath();
    applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(
        `INSERT INTO merchant_registry (merchant_id, name, country, feed_url, feed_format, polling_interval_ms)
         VALUES ('longero', 'Longero', 'EE', 'https://longero.fi', 'json', 86400000)`,
      );
      const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
      expect(() => assertVerificationRow(row)).not.toThrow();
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('seeds the registry alongside an operator row occupying a bootstrap id (staging deploy 37614170668 regression)', () => {
    // Staging's failure state: an operator-added row (longero) held id 3,
    // and the old explicit-id INSERT OR IGNORE assigned araxes the same id —
    // the bootstrap row was silently swallowed and the presence gate failed
    // with merchant_registry_araxes: expected 1, got 0. The natural-key
    // upsert autoassigns ids, so the fake operator row and all three seed
    // rows must coexist.
    const dbPath = freshDatabasePath();
    const pre = new DatabaseSync(dbPath);
    for (const file of listMigrationFiles(MIGRATIONS_DIR)) {
      pre.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    }
    pre.exec(
      `INSERT INTO merchant_registry (id, merchant_id, name, country, feed_url, feed_format, polling_interval_ms)
       VALUES (3, 'fake-operator', 'Fake Operator', 'EE', 'https://fake-operator.example', 'json', 86400000)`,
    );
    pre.close();

    // Schema already present → migrations skipped, seed applied on top of
    // the collision state; verification must PASS with all rows present.
    const result = applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });
    expect(result.migrationsApplied).toEqual([]);

    const db = new DatabaseSync(dbPath);
    try {
      const rows = db
        .prepare('SELECT merchant_id FROM merchant_registry ORDER BY merchant_id')
        .all() as Array<{ merchant_id: string }>;
      expect(rows.map((r) => r.merchant_id)).toEqual([
        'alko',
        'alks',
        'araxes',
        'drinkonline',
        'fake-operator',
        'lazyshop',
        'licorea',
        'spritxxl',
        'viinarannasta',
        'viinikauppa',
      ]);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('guards each governance seed row on source presence, excluding permission_status (never resurrects, never downgrades)', () => {
    const sql = generateSourceGovernanceSql();
    // One guarded INSERT per seed row…
    const guards = sql.match(/WHERE NOT EXISTS \(/g) ?? [];
    expect(guards).toHaveLength(Object.keys(buildExpectations().sourceGovernanceRows).length);
    // …and the guard names the source identity but NOT the status: an
    // operator's in-place GRANTED→REVOKED transition must survive every
    // re-seed (the seed is bootstrap-only).
    expect(sql).toContain(`"acquisition_method" = 'COMPLIANT_CRAWLING'`);
    expect(sql).toContain(`"source_url" = 'https://viinarannasta.eu/1_fi_0_sitemap.xml'`);
    const guardBlocks = sql.split('WHERE NOT EXISTS (').slice(1);
    for (const block of guardBlocks) {
      // Scope to the guard's own SELECT (it ends at the first `);`) — the
      // next statement's INSERT column list legitimately names
      // permission_status.
      const guardSelect = block.slice(0, block.indexOf(');'));
      expect(guardSelect).not.toContain('permission_status');
    }
  });

  it('seeds the sitemap-crawl merchants — GRANTED crawl rows, parked PENDING rows without feedUrl', () => {
    const dbPath = freshDatabasePath();
    applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    const db = new DatabaseSync(dbPath);
    try {
      const registry = db
        .prepare(
          `SELECT merchant_id, feed_url, feed_format, polling_interval_ms
           FROM merchant_registry WHERE merchant_id IN ('viinarannasta','viinikauppa','licorea','drinkonline','spritxxl','lazyshop')`,
        )
        .all() as Array<{
        merchant_id: string;
        feed_url: string;
        feed_format: string;
        polling_interval_ms: number;
      }>;
      // All six present, xml, daily cadence…
      expect(registry).toHaveLength(6);
      for (const row of registry) {
        expect(row.feed_format).toBe('xml');
        expect(row.polling_interval_ms).toBe(86_400_000);
      }
      const feedUrlByMerchant = new Map(registry.map((r) => [r.merchant_id, r.feed_url]));
      expect(feedUrlByMerchant.get('viinarannasta')).toBe('https://viinarannasta.eu/1_fi_0_sitemap.xml');
      expect(feedUrlByMerchant.get('viinikauppa')).toBe('https://www.viinikauppa.com/catalog/xmlsitemap/products');
      expect(feedUrlByMerchant.get('licorea')).toBe('https://www.licorea.com/sitemapproducts_en.xml');
      expect(feedUrlByMerchant.get('drinkonline')).toBe('https://www.drinkonline.eu/sitemap-products.xml');
      // …the parked two carry the empty feedUrl the producer skips on.
      expect(feedUrlByMerchant.get('spritxxl')).toBe('');
      expect(feedUrlByMerchant.get('lazyshop')).toBe('');

      const governance = db
        .prepare(
          `SELECT merchant_id, permission_status FROM source_governance
           WHERE acquisition_method = 'COMPLIANT_CRAWLING'
           ORDER BY merchant_id`,
        )
        .all() as Array<{ merchant_id: string; permission_status: string }>;
      expect(governance).toEqual([
        { merchant_id: 'drinkonline', permission_status: 'GRANTED' },
        { merchant_id: 'lazyshop', permission_status: 'PENDING' },
        { merchant_id: 'licorea', permission_status: 'GRANTED' },
        { merchant_id: 'spritxxl', permission_status: 'PENDING' },
        { merchant_id: 'viinarannasta', permission_status: 'GRANTED' },
        { merchant_id: 'viinikauppa', permission_status: 'GRANTED' },
      ]);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

  it('never resurrects a REVOKED governance row on re-apply (operator withdrawal survives re-seeding)', () => {
    // The high-liability property of the presence guard: status moves in
    // place through the console (GRANTED → REVOKED, forward-only), so a
    // re-run of the seed over an environment where the operator withdrew
    // a permission must re-insert NOTHING — resurrecting GRANTED would
    // reopen crawling behind the operator's back.
    const dbPath = freshDatabasePath();
    applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    let db = new DatabaseSync(dbPath);
    db.exec(
      `UPDATE source_governance SET permission_status = 'REVOKED' WHERE merchant_id = 'viinarannasta'`,
    );
    db.close();

    applySeedToSqlite(dbPath, { migrationsDir: MIGRATIONS_DIR, seedSqlFiles: seedFiles });

    db = new DatabaseSync(dbPath);
    try {
      const rows = db
        .prepare(
          `SELECT permission_status FROM source_governance WHERE merchant_id = 'viinarannasta'`,
        )
        .all() as Array<{ permission_status: string }>;
      expect(rows).toEqual([{ permission_status: 'REVOKED' }]);
    } finally {
      db.close();
    }
  }, DB_TEST_TIMEOUT_MS);

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
  }, DB_TEST_TIMEOUT_MS);
});

describe('assertVerificationRow count semantics', () => {
  const expectations = buildExpectations();

  // Mirror of generate.ts's private versionFieldName (label → SQL field).
  const versionField = (label: string) =>
    `tax_rules_${label.replace(/[^A-Za-z0-9]/g, '_')}`;

  /** A fully-seeded row, overridable per field. */
  function verificationRow(
    overrides: Record<string, number> = {},
  ): Record<string, number> {
    return {
      tax_rules_total: expectations.taxRulesTotal,
      ...Object.fromEntries(
        Object.entries(expectations.taxRulesPerVersion).map(([label, count]) => [
          versionField(label),
          count,
        ]),
      ),
      spot_beer_rate_rows: 1,
      ...Object.fromEntries(
        Object.entries(expectations.merchantRegistryRows).map(([merchantId, count]) => [
          `merchant_registry_${merchantId.replace(/[^A-Za-z0-9]/g, '_')}`,
          count,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(expectations.sourceGovernanceRows).map(([merchantId, count]) => [
          `source_governance_${merchantId.replace(/[^A-Za-z0-9]/g, '_')}`,
          count,
        ]),
      ),
      transport_offers_total: expectations.transportOffers,
      product_master_total: expectations.productMaster,
      retail_offers_total: expectations.retailOffers,
      staging_reviews_total: expectations.stagingReviews,
      consumption_norms_total: expectations.consumptionNormsRows,
      carrier_box_types_total: expectations.carrierBoxTypesRows,
      fts_indexed_products: expectations.ftsIndexedProducts,
      ...overrides,
    };
  }

  it('accepts exact counts (fresh database)', () => {
    expect(() => assertVerificationRow(verificationRow())).not.toThrow();
  });

  it('tolerates ingested growth above the fixture floor (staging producer + curated sync)', () => {
    expect(() =>
      assertVerificationRow(
        verificationRow({
          product_master_total: expectations.productMaster + 2353,
          retail_offers_total: expectations.retailOffers + 14261,
          fts_indexed_products: expectations.ftsIndexedProducts + 2353,
          // The monthly curated-rate-refresh cron legitimately appends
          // curated carrier datasets (fransberg, posti) past the seed
          // fixture's 12 demo rows.
          transport_offers_total: expectations.transportOffers + 36,
        }),
      ),
    ).not.toThrow();
  });

  it('still fails when ingestion-shared tables fall below the fixture floor', () => {
    expect(() =>
      assertVerificationRow(
        verificationRow({ product_master_total: expectations.productMaster - 1 }),
      ),
    ).toThrow(/product_master_total/);
  });

  it('still fails when a seeded merchant row is missing (seed loss)', () => {
    const firstSeeded = Object.keys(expectations.merchantRegistryRows)[0];
    const field = `merchant_registry_${firstSeeded.replace(/[^A-Za-z0-9]/g, '_')}`;
    expect(() =>
      assertVerificationRow(
        verificationRow({ [field]: 0 }),
      ),
    ).toThrow(new RegExp(field));
  });

  it('tolerates a governance row whose status moved in place (operator GRANTED→REVOKED is not seed loss)', () => {
    // The presence count keys on (merchant, method, source_url) in any
    // status, so the console's forward-only transitions never fail the
    // gate; the row count itself is unchanged.
    const firstGoverned = Object.keys(expectations.sourceGovernanceRows)[0];
    const field = `source_governance_${firstGoverned.replace(/[^A-Za-z0-9]/g, '_')}`;
    expect(() =>
      assertVerificationRow(verificationRow({ [field]: 1 })),
    ).not.toThrow();
  });

  it('still fails when a seeded governance source row is missing entirely', () => {
    const firstGoverned = Object.keys(expectations.sourceGovernanceRows)[0];
    const field = `source_governance_${firstGoverned.replace(/[^A-Za-z0-9]/g, '_')}`;
    expect(() =>
      assertVerificationRow(
        verificationRow({ [field]: 0 }),
      ),
    ).toThrow(new RegExp(field));
  });

  it('still fails when a seed-owned table loses rows (seed loss)', () => {
    expect(() =>
      assertVerificationRow(
        verificationRow({ transport_offers_total: expectations.transportOffers - 1 }),
      ),
    ).toThrow(/transport_offers_total/);
  });
});

/** Local helper so each generation test re-generates independently. */
function generateSeedFilesSafe(): Array<{ name: string; sql: string }> {
  return generateSeedSqlFiles();
}

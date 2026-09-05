/**
 * Data-quality checks on D1 (task 2.7, change migrate-to-cloudflare).
 * D1 port of scripts/test-data-quality.sh + the DataQualityService
 * invariants; the pg script stays untouched for the Postgres stack.
 *
 * The pg script's three legs, mapped 1:1:
 *
 *   1. Schema conformance ("all expected tables exist") → the D1 table
 *      set must exist in sqlite_master after the committed migrations:
 *      the 20 relational tables plus the FTS5 external-content index and
 *      the staging-infra table the seed creates.
 *   2. Tax rules generated from SEED_RULES and loaded (the
 *      export-seed-sql.mjs leg) → the byte-deterministic D1 seed pipeline
 *      contract: generate → apply (migrations first, idempotent seed
 *      files second) → verify row counts + version presence, failing
 *      loudly on any mismatch — the exact applySeedToSqlite path
 *      `scripts/seed-d1.ts --db-file` runs, proven re-appliable.
 *   3. Data-quality vitest suite ("src/**&#47;*data-quality*.test.ts") →
 *      DataQualityService.runQualityCheck / checkOfferFreshness /
 *      verifyNoSilentVerified executed over offers READ from the D1
 *      retail_offers table, plus the critical-field NOT NULL enforcement
 *      the schema-level check stands for.
 *
 * Runs on the node:sqlite D1 harness — no psql, no Postgres.
 *
 * @module DataQualityD1Test
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ReliabilityService } from '@rajahinta/core-domain';
import {
  DataQualityService,
  type QualityCheckOffer,
} from '../../../packages/data-acquisition/src/services/data-quality.service';

import {
  generateSeedSqlFiles,
} from '../../../packages/data-platform/src/seed/d1/generate';
import {
  applySeedToSqlite,
} from '../../../packages/data-platform/src/seed/d1/apply-node-sqlite';

import { openMigratedD1 } from './harness';

// ---------------------------------------------------------------------------
// Leg 1 — schema conformance
// ---------------------------------------------------------------------------

describe('D1 schema conformance', () => {
  const { db } = openMigratedD1();

  /** The 20 relational tables the committed migrations create. */
  const EXPECTED_TABLES = [
    'accounts',
    'aggregation_watermarks',
    'audit_events',
    'basket_calculation_records',
    'carrier_box_types',
    'calculation_records',
    'click_counter_snapshots',
    'fx_rate_datasets',
    'fx_rates',
    'merchant_registry',
    'merchant_terms',
    'price_history_summaries',
    'product_dimensions',
    'product_master',
    'retail_offers',
    'saved_baskets',
    'saved_scenarios',
    'sessions',
    'tax_rules',
    'transport_offers',
  ];

  const existingTables = (): string[] =>
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as unknown as { name: string }[]
    ).map((r) => r.name);

  it('has every expected relational table after the migrations', () => {
    const present = existingTables();
    const missing = EXPECTED_TABLES.filter((t) => !present.includes(t));
    expect(missing, `missing tables: ${missing.join(', ')}`).toEqual([]);
  });

  it('has the FTS5 product-search index (external-content virtual table)', () => {
    const virtual = (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'`,
        )
        .all() as unknown as { name: string }[]
    ).map((r) => r.name);
    expect(virtual).toContain('product_master_fts');
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — seed pipeline contract (generate → apply → verify, idempotent)
// ---------------------------------------------------------------------------

describe('D1 seed pipeline contract (SEED_RULES single source of truth)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'rajahinta-d1-data-quality-'));
  const dbFile = path.join(dir, 'seeded.sqlite');
  const migrationsDir = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'packages',
    'data-platform',
    'src',
    'd1',
    'migrations',
  );

  /** Write the generated seed SQL to temp paths (no repo writes). */
  const writtenSeedFiles = () =>
    generateSeedSqlFiles().map((f) => {
      const p = path.join(dir, `${f.name}.written`);
      writeFileSync(p, f.sql);
      return { name: f.name, path: p };
    });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies migrations then the generated seed files and verification passes', () => {
    // generateSeedSqlFiles: byte-deterministic SQL from SEED_RULES — the
    // same source scripts/export-seed-sql.mjs renders for pg.
    const seedNames = generateSeedSqlFiles().map((f) => f.name);
    expect(seedNames.length).toBeGreaterThan(0);

    const result = applySeedToSqlite(dbFile, {
      migrationsDir,
      seedSqlFiles: writtenSeedFiles(),
    });

    expect(result.migrationsApplied.length).toBeGreaterThan(0);
    expect(result.verification.tax_rules_total).toBeGreaterThan(0);
    expect(result.verification.staging_reviews_total).toBeGreaterThan(0);
    expect(result.verification.fts_indexed_products).toBeGreaterThan(0);
  });

  it('re-application is idempotent — no migrations re-run, verification still passes', () => {
    const second = applySeedToSqlite(dbFile, {
      migrationsDir,
      seedSqlFiles: writtenSeedFiles(),
    });

    // Schema already present → no migration files applied this run.
    expect(second.migrationsApplied).toEqual([]);
    // Row counts still match expectations (no duplicates from re-seed).
    expect(second.verification.tax_rules_total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — DataQualityService invariants over D1-sourced offers
// ---------------------------------------------------------------------------

describe('data-quality invariants over D1 retail offers', () => {
  const { d1 } = openMigratedD1();
  const quality = new DataQualityService(new ReliabilityService());

  const PRODUCT_ID = 8100;
  const MERCHANT = 'data-quality-d1-merchant';

  let offers: QualityCheckOffer[] = [];

  const insertOffer = (
    id: number,
    observedAt: Date,
    reliabilityStatus: string,
  ): Promise<unknown> => {
    return d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, availability, source_url, observed_at, reliability_status)
       VALUES (?, ?, 'DE', ?, 199, 'EUR', 'in_stock', 'https://merchant.example.com/dq', ?, ?)`,
      )
      .bind(id, MERCHANT, PRODUCT_ID, observedAt.toISOString(), reliabilityStatus)
      .run();
  };

  beforeAll(async () => {
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification)
         VALUES (?, 'Data Quality Fixture', 'DQ Brewery', 'DQ', 'beer',
                 0.5, 'can', 'beer')`,
      )
      .bind(PRODUCT_ID)
      .run();

    const HOUR_MS = 3_600_000;
    // Relative to the REAL clock — checkOfferFreshness assesses against
    // now, so the fixture must be too.
    const now = Date.now();
    // Fresh + honestly VERIFIED → counts as verified.
    await insertOffer(1, new Date(now - 1 * HOUR_MS), 'VERIFIED');
    // Stale (past the 24 h price threshold) but honestly ESTIMATED →
    // counts as stale, NOT flagged silent-VERIFIED.
    await insertOffer(2, new Date(now - 72 * HOUR_MS), 'ESTIMATED');
    // Stale but silently stored VERIFIED → flagged.
    await insertOffer(3, new Date(now - 72 * HOUR_MS), 'VERIFIED');

    offers = (
      (await d1
        .prepare(
          `SELECT merchant, product_id, observed_at, reliability_status
             FROM retail_offers WHERE merchant = ? ORDER BY id`,
        )
        .bind(MERCHANT)
        .all()).results as unknown as {
        merchant: string;
        product_id: number;
        observed_at: string;
        reliability_status: string;
      }[]
    ).map((row) => ({
      merchant: row.merchant,
      productId: row.product_id,
      observedAt: new Date(row.observed_at),
      reliabilityStatus: row.reliability_status,
    }));

    expect(offers).toHaveLength(3);
  });

  it('counts freshness statuses from the D1 rows and flags only the silent-VERIFIED one', () => {
    const report = quality.runQualityCheck(offers);

    expect(report.totalOffers).toBe(3);
    expect(report.verifiedCount).toBe(1);
    expect(report.staleCount).toBe(2);
    // Exactly the dishonest row is flagged.
    expect(report.flaggedIssues).toHaveLength(1);
    expect(report.flaggedIssues[0]).toContain(MERCHANT);
  });

  it('verifyNoSilentVerified passes for honest rows and fails for the D1 row lying about freshness', () => {
    const [fresh, honestStale, liar] = offers;

    // Signature: (storedStatus, actualStatus) — the actual status assessed
    // by checkOfferFreshness against the price-domain threshold.
    expect(
      quality.verifyNoSilentVerified('VERIFIED', quality.checkOfferFreshness(fresh, 'price')),
    ).toBe(true);
    expect(
      quality.verifyNoSilentVerified('ESTIMATED', quality.checkOfferFreshness(honestStale, 'price')),
    ).toBe(true);
    expect(
      quality.verifyNoSilentVerified('VERIFIED', quality.checkOfferFreshness(liar, 'price')),
    ).toBe(false);
  });

  it('enforces the schema-level critical-field NOT NULLs (merchant, price)', async () => {
    await expect(
      d1.prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents)
         VALUES (9999, NULL, 'DE', ?, 199)`,
      ).bind(PRODUCT_ID)
      .run(),
    ).rejects.toThrow();

    await expect(
      d1.prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents)
         VALUES (9999, ?, 'DE', ?, NULL)`,
      ).bind(MERCHANT, PRODUCT_ID)
      .run(),
    ).rejects.toThrow();
  });
});

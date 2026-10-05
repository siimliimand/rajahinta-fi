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

import { ReliabilityService, NONALCOHOLIC_HOLD_REASON } from '@rajahinta/core-domain';
import {
  DataQualityService,
  type QualityCheckOffer,
} from '../../../packages/data-acquisition/src/services/data-quality.service';
import { D1ProductSearchRepository } from '../../../packages/data-platform/src/repositories/d1/product-search.repository';

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

  /** Relational-table spot check (additive across waves; the shared
   * *-check constraint guarantees these exist after the migrations). */
  const EXPECTED_TABLES = [
    'accounts',
    'aggregation_watermarks',
    'audit_events',
    'basket_calculation_records',
    'carrier_box_types',
    'calculation_records',
    'click_counter_snapshots',
    'merchant_registry',
    'merchant_terms',
    'newsletter_notifications',
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

  it('has the product_master review-hold column (migration 0029, nonalcoholic-catalog-hygiene)', () => {
    const columns = (
      db
        .prepare(`PRAGMA table_info(product_master)`)
        .all() as unknown as { name: string }[]
    ).map((c) => c.name);
    expect(columns).toContain('review_hold_reason');
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

// ---------------------------------------------------------------------------
// Leg 4 — EUR-only invariant (design D3, change
// drop-sweden-eur-only-alko-benchmark): every stored offer is EUR
// ---------------------------------------------------------------------------

/** The invariant query: count offers whose currency is not (or may not be read as) EUR. */
function countNonEurOffers(
  database: ReturnType<typeof openMigratedD1>['d1'],
): Promise<number> {
  return database
    .prepare(
      `SELECT COUNT(*) AS violations
         FROM retail_offers
        WHERE currency IS NULL OR UPPER(TRIM(currency)) <> 'EUR'`,
    )
    .first<{ violations: number }>()
    .then((row) => row?.violations ?? 0);
}

describe('EUR-only invariant over stored offers (design D3)', () => {
  const { d1 } = openMigratedD1();

  const PRODUCT_ID = 8200;
  const MERCHANT = 'eur-invariant-merchant';

  it('passes on a clean database — zero non-EUR offers stored', async () => {
    await expect(countNonEurOffers(d1)).resolves.toBe(0);
  });

  it('fails on violation — a non-EUR row is detected by the invariant query', async () => {
    await d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            unit_volume, container_type, regulatory_classification)
         VALUES (?, 'EUR Invariant Fixture', 'DQ Brewery', 'DQ', 'beer',
                 0.5, 'can', 'beer')`,
      )
      .bind(PRODUCT_ID)
      .run();

    // The schema deliberately has no CHECK pinning the currency (design
    // D3 keeps the column unconstrained to avoid a second migration);
    // the suite-level invariant is what fails the run on violation.
    await d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            currency, availability, observed_at, reliability_status)
         VALUES (8201, ?, 'DE', ?, 199, 'USD', 'in_stock',
                 '2026-09-06T00:00:00.000Z', 'ESTIMATED')`,
      )
      .bind(MERCHANT, PRODUCT_ID)
      .run();

    await expect(countNonEurOffers(d1)).resolves.toBe(1);

    // Repair and re-check: the suite passes again — proving the gate is
    // the query, not the schema, and that a violating dataset is caught.
    await d1
      .prepare(`DELETE FROM retail_offers WHERE id = 8201`)
      .run();
    await expect(countNonEurOffers(d1)).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Leg 5 — listing-universe invariants (task 3.4, change
// nonalcoholic-catalog-hygiene): an alcohol-category row with zero or
// unparseable ABV must be review-held, held rows keep their history, and
// the shared predicate answers the consumer read paths
// ---------------------------------------------------------------------------

/** Alcohol categories per the ingestion guard's scope (schema D2 constant). */
const ALCOHOL_CATEGORIES_SQL = `'beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits'`;

/**
 * The guard-completeness invariant: every zero/unparseable-ABV row in an
 * alcohol category carries a review hold. An unheld row here is exactly
 * the defect the ingestion guard exists to prevent — a non-alcoholic
 * grocery admitted into the alcohol catalog without review state.
 */
function countUnheldNonAlcoholicRows(
  database: ReturnType<typeof openMigratedD1>['d1'],
): Promise<number> {
  return database
    .prepare(
      `SELECT COUNT(*) AS violations
         FROM product_master
        WHERE category IN (${ALCOHOL_CATEGORIES_SQL})
          AND (alcohol_by_volume IS NULL OR alcohol_by_volume <= 0)
          AND review_hold_reason IS NULL`,
    )
    .first<{ violations: number }>()
    .then((row) => row?.violations ?? 0);
}

describe('listing-universe invariants over stored products (nonalcoholic-catalog-hygiene 3.4)', () => {
  const { d1 } = openMigratedD1();

  const insertProduct = (
    id: number,
    name: string,
    abv: number | null,
    holdReason: string | null,
    category = 'beer',
  ): Promise<unknown> =>
    d1
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            alcohol_by_volume, unit_volume, container_type, regulatory_classification,
            review_hold_reason)
         VALUES (?, ?, 'DQ Brewery', 'DQ', ?, ?, 0.5, 'can', 'beer', ?)`,
      )
      .bind(id, name, category, abv, holdReason)
      .run();

  const insertOffer = (id: number, productId: number): Promise<unknown> =>
    d1
      .prepare(
        `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
            currency, availability, source_url, observed_at, reliability_status)
         VALUES (?, 'dq-merchant', 'DE', ?, 199, 'EUR', 'in_stock',
                 'https://merchant.example.com/hold', '2026-10-01T00:00:00.000Z', ?)`,
      )
      .bind(id, productId, productId === 8305 ? 'ESTIMATED' : 'VERIFIED')
      .run();

  const CONTROL = 8300; // parsed ABV > 0 — in the universe
  const VIOLATION = 8301; // zero ABV, UNHELD — the guard's target shape
  const HELD_ZERO = 8302; // zero ABV, held
  const HELD_NULL = 8303; // NULL ABV (unparseable), held
  const HELD_WITH_ABV = 8304; // parseable ABV, but review-held
  const ESTIMATED_ABV = 8305; // parsed ABV > 0, ESTIMATED-offer provenance

  it('flags an unheld zero-ABV row in an alcohol category as a guard violation', async () => {
    await expect(countUnheldNonAlcoholicRows(d1)).resolves.toBe(0);

    await insertProduct(VIOLATION, 'Unheld Zero ABV', 0, null);
    await insertOffer(8311, VIOLATION);
    await expect(countUnheldNonAlcoholicRows(d1)).resolves.toBe(1);
  });

  it('passes once the ingestion guard stamps the hold — with the core-domain token', async () => {
    // The write the ingestion guard performs (NONALCOHOLIC_HOLD_REASON,
    // exported from core-domain — the suites pin the token, not a literal).
    await d1
      .prepare(`UPDATE product_master SET review_hold_reason = ? WHERE id = ?`)
      .bind(NONALCOHOLIC_HOLD_REASON, VIOLATION)
      .run();
    await expect(countUnheldNonAlcoholicRows(d1)).resolves.toBe(0);

    // The full intended shape set coexists: held zero-ABV, held
    // unparseable-ABV, held parseable-ABV — review state, never deletion.
    await insertProduct(HELD_ZERO, 'Held Zero ABV', 0, NONALCOHOLIC_HOLD_REASON);
    await insertOffer(8312, HELD_ZERO);
    await insertProduct(HELD_NULL, 'Held Unknown ABV', null, NONALCOHOLIC_HOLD_REASON);
    await insertOffer(8313, HELD_NULL);
    await insertProduct(HELD_WITH_ABV, 'Held Real ABV', 0.047, NONALCOHOLIC_HOLD_REASON);
    await insertOffer(8314, HELD_WITH_ABV);
    await insertProduct(CONTROL, 'Control Real ABV', 0.047, null);
    await insertOffer(8310, CONTROL);
    await insertProduct(ESTIMATED_ABV, 'Estimated ABV Control', 0.045, null);
    await insertOffer(8315, ESTIMATED_ABV);

    await expect(countUnheldNonAlcoholicRows(d1)).resolves.toBe(0);

    // Hold for review, never delete (design D1): every held row's offer
    // history survived the hold intact.
    const offersOnHeldRows = await d1
      .prepare(
        `SELECT COUNT(*) AS n FROM retail_offers
          WHERE product_id IN (${HELD_ZERO}, ${HELD_NULL}, ${HELD_WITH_ABV})`,
      )
      .first<{ n: number }>();
    expect(offersOnHeldRows?.n).toBe(3);
  });

  it('the consumer read paths answer from the same universe — held and zero/unparseable rows appear nowhere, the controls (ESTIMATED provenance included) everywhere', async () => {
    // Integration-level witness over the real migrated schema; the
    // per-path repository matrix lives in the data-platform suite.
    const repo = new D1ProductSearchRepository(d1);

    const page = await repo.listCatalogPage(1, 50);
    const listedIds = page.items.map((item) => item.product.id).sort((a, b) => a - b);
    expect(listedIds).toEqual([CONTROL, ESTIMATED_ABV]);
    expect(page.total).toBe(2);

    // Detail degrades consistently with the same predicate (spec
    // product-catalog): a held row's detail page is a not-found.
    for (const id of [VIOLATION, HELD_ZERO, HELD_NULL, HELD_WITH_ABV]) {
      await expect(repo.findById(id), `product ${id} must be outside the universe`).resolves.toBeNull();
    }
    await expect(repo.findById(CONTROL)).resolves.not.toBeNull();
    await expect(repo.findById(ESTIMATED_ABV)).resolves.not.toBeNull();
  });
});

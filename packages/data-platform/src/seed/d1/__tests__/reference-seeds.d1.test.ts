/**
 * Tests for the event-calculator reference seed files (task 1.1, change
 * eventcalc-reference-seed-wiring): consumption-norms.d1.sql and
 * carrier-box-types.d1.sql.
 *
 * Pins the four properties the wiring's correctness rests on:
 *
 * 1. Parity — the generated SQL applied to a migrated empty database
 *    yields rows row-for-row equal to the function seeds' output
 *    (seedConsumptionNorms / seedCarrierBoxTypes). One source of truth,
 *    two apply paths.
 *
 * 2. Idempotency — re-applying consumption-norms.d1.sql over a
 *    seeded-then-published database leaves the PUBLISHED row
 *    byte-identical (append-only dataset, design D2) while refreshing
 *    PENDING_CONFIRMATION rows; the box file's plain upsert restores
 *    drifted values in place.
 *
 * 3. Byte-determinism — regeneration is diff-able (no wall clock).
 *
 * 4. Fail-loudly verification — buildVerifySql()'s new assertions trip on
 *    a wiped table and pass a seeded one (design D3).
 *
 * @module Tests/Seed/D1/ReferenceSeeds
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SEED_SQL_FILES,
  SeedVerificationError,
  assertVerificationRow,
  buildVerifySql,
  generateCarrierBoxTypesSql,
  generateConsumptionNormsSql,
  generateSeedSqlFiles,
  writeSeedSqlFiles,
} from '../generate';
import { openMigratedD1 } from '../../../repositories/d1/__tests__/d1-test-harness';
import {
  ALL_CONSUMPTION_NORMS_SEED_ROWS,
  SEASONAL_CONSUMPTION_NORMS_SEED_ROWS,
  SEASONAL_CONSUMPTION_NORMS_SEED_VERSION,
  seedConsumptionNorms,
} from '../../consumption-norms.seed';
import { CARRIER_BOX_TYPES_SEED, seedCarrierBoxTypes } from '../../carrier-box-types.seed';

// The migrations create the tables; both apply paths omit created_at, so
// the wall-clock default is the only column parity must not compare.
const NORM_PARITY_COLUMNS =
  'id, version_label, drink_type, event_profile, norm_value_per_guest_per_hour, ' +
  'source_citation, status, effective_from, effective_to, confirmed_by, confirmed_at';

const BOX_PARITY_COLUMNS =
  'id, carrier, name, internal_height_mm, internal_width_mm, internal_depth_mm, ' +
  'max_weight_g, source, observed_at';

function selectNorms(db: DatabaseSync): unknown[] {
  return db
    .prepare(
      `SELECT ${NORM_PARITY_COLUMNS} FROM consumption_norms ORDER BY id`,
    )
    .all();
}

function selectBoxes(db: DatabaseSync): unknown[] {
  return db
    .prepare(
      `SELECT ${BOX_PARITY_COLUMNS} FROM carrier_box_types ORDER BY id`,
    )
    .all();
}

describe('reference seed generators — registration + shape', () => {
  it('registers both files in SEED_SQL_FILES, in apply order', () => {
    expect(SEED_SQL_FILES.map((f) => f.name)).toEqual([
      'tax-rules.d1.sql',
      'staging.d1.sql',
      'source-governance.d1.sql',
      'consumption-norms.d1.sql',
      'carrier-box-types.d1.sql',
    ]);
  });

  it('norms upsert refreshes PENDING_CONFIRMATION rows only (design D2)', () => {
    const sql = generateConsumptionNormsSql();
    expect(sql).toContain(
      'ON CONFLICT ("drink_type", "event_profile", "version_label") DO UPDATE SET',
    );
    // The immutable-history guard: a published row fails the WHERE and the
    // rewrite is skipped. No such WHERE on the box file (no lifecycle).
    expect(sql).toContain(`WHERE "consumption_norms"."status" = 'PENDING_CONFIRMATION';`);
  });

  it('boxes upsert is a plain replace on (carrier, name)', () => {
    const sql = generateCarrierBoxTypesSql();
    expect(sql).toContain('ON CONFLICT ("carrier", "name") DO UPDATE SET');
    expect(sql).not.toMatch(/WHERE\s+"consumption_norms"/);
  });

  it('emits one row per curated constant, in constant order', () => {
    const normsSql = generateConsumptionNormsSql();
    for (const row of ALL_CONSUMPTION_NORMS_SEED_ROWS) {
      expect(normsSql).toContain(`'${row.drinkType}', '${row.eventProfile}',`);
    }
    // The seasonal dataset rides the same file; its rows appear under
    // their own version label (byte-stable standard prefix first).
    expect(normsSql).toContain(`'${SEASONAL_CONSUMPTION_NORMS_SEED_VERSION}', 'beer', 'juhannus',`);
    const boxesSql = generateCarrierBoxTypesSql();
    for (const row of CARRIER_BOX_TYPES_SEED) {
      expect(boxesSql).toContain(`'${row.carrier}', '${row.name}',`);
    }
  });
});

describe('reference seed parity — generated SQL vs function seeds (node:sqlite)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('consumption norms: rows are equal row-for-row, ids included, both datasets', async () => {
    const viaFunction = openMigratedD1();
    const viaSql = openMigratedD1();

    await seedConsumptionNorms(viaFunction.d1);
    viaSql.db.exec(generateConsumptionNormsSql());

    expect(selectNorms(viaFunction.db)).toHaveLength(
      ALL_CONSUMPTION_NORMS_SEED_ROWS.length,
    );
    expect(selectNorms(viaSql.db)).toEqual(selectNorms(viaFunction.db));

    // The seasonal rows specifically: both apply paths land the
    // seasonal-occasions version identically.
    const seasonalViaFunction = (selectNorms(viaFunction.db) as Array<{ version_label: string }>)
      .filter((row) => row.version_label === SEASONAL_CONSUMPTION_NORMS_SEED_VERSION);
    expect(seasonalViaFunction).toHaveLength(
      SEASONAL_CONSUMPTION_NORMS_SEED_ROWS.length,
    );
  }, DB_TEST_TIMEOUT_MS);

  it('carrier boxes: rows are equal row-for-row, ids included', async () => {
    const viaFunction = openMigratedD1();
    const viaSql = openMigratedD1();

    await seedCarrierBoxTypes(viaFunction.d1);
    viaSql.db.exec(generateCarrierBoxTypesSql());

    expect(selectBoxes(viaSql.db)).toEqual(selectBoxes(viaFunction.db));
  }, DB_TEST_TIMEOUT_MS);
});

describe('reference seed idempotency (node:sqlite)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  it('re-applying the norms SQL over a seeded-then-published DB leaves the PUBLISHED row byte-identical and refreshes PENDING', () => {
    const { db } = openMigratedD1();
    const normsSql = generateConsumptionNormsSql();

    db.exec(normsSql);
    // The operator confirms publication through the manual console step.
    db.exec(
      `UPDATE consumption_norms
       SET status = 'PUBLISHED', confirmed_by = 'owner@example.invalid',
           confirmed_at = '2026-10-03T00:00:00.000Z'
       WHERE drink_type = 'beer' AND event_profile = 'casual_gathering'`,
    );
    // Post-publication drift on the published row and on two pending rows
    // (one per dataset): the re-apply must reconcile NEITHER drift into
    // the published row's fate — the published row stays untouched
    // (append-only), both pending rows are refreshed back to the curated
    // values.
    db.exec(
      `UPDATE consumption_norms SET norm_value_per_guest_per_hour = 9.99
       WHERE status = 'PUBLISHED'`,
    );
    db.exec(
      `UPDATE consumption_norms SET norm_value_per_guest_per_hour = 8.88
       WHERE drink_type = 'spirits' AND event_profile = 'celebration'`,
    );
    db.exec(
      `UPDATE consumption_norms SET norm_value_per_guest_per_hour = 8.88
       WHERE drink_type = 'spirits' AND event_profile = 'rapujuhlat'`,
    );

    const publishedBefore = db
      .prepare('SELECT * FROM consumption_norms WHERE status = \'PUBLISHED\'')
      .all();

    db.exec(normsSql);

    // PUBLISHED row byte-identical — drift unrepaired by design.
    const publishedAfter = db
      .prepare('SELECT * FROM consumption_norms WHERE status = \'PUBLISHED\'')
      .all();
    expect(publishedAfter).toEqual(publishedBefore);
    expect(
      (publishedAfter[0] as { norm_value_per_guest_per_hour: number }).norm_value_per_guest_per_hour,
    ).toBe(9.99);

    // PENDING rows refreshed — across BOTH datasets: the tampered values
    // are gone, and no other row was duplicated or lost.
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN status = 'PENDING_CONFIRMATION'
                          AND norm_value_per_guest_per_hour != 8.88 THEN 1 ELSE 0 END) AS refreshed
         FROM consumption_norms`,
      )
      .get() as { total: number; published: number; refreshed: number };
    expect(counts).toEqual({
      total: ALL_CONSUMPTION_NORMS_SEED_ROWS.length,
      published: 1,
      refreshed: ALL_CONSUMPTION_NORMS_SEED_ROWS.length - 1,
    });
  }, DB_TEST_TIMEOUT_MS);

  it('re-applying the boxes SQL replaces curated values in place, never duplicates', () => {
    const { db } = openMigratedD1();
    const boxesSql = generateCarrierBoxTypesSql();

    db.exec(boxesSql);
    db.exec(boxesSql);
    expect(selectBoxes(db)).toHaveLength(CARRIER_BOX_TYPES_SEED.length);

    // Plain-replace contract: a drifted value is repaired on re-apply.
    db.exec(`UPDATE carrier_box_types SET max_weight_g = 1 WHERE carrier = 'dhl' AND name = 'DHL Paket XL'`);
    db.exec(boxesSql);
    const repaired = db
      .prepare(`SELECT max_weight_g FROM carrier_box_types WHERE carrier = 'dhl' AND name = 'DHL Paket XL'`)
      .get() as { max_weight_g: number };
    expect(repaired.max_weight_g).toBe(
      CARRIER_BOX_TYPES_SEED.find((b) => b.carrier === 'dhl' && b.name === 'DHL Paket XL')!
        .maxWeightG,
    );
  }, DB_TEST_TIMEOUT_MS);
});

describe('reference seed byte-determinism', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'reference-seed-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('regenerating the files produces byte-identical output (regenerate = no diff)', () => {
    const dirA = join(workDir, 'a');
    const dirB = join(workDir, 'b');
    const writtenA = writeSeedSqlFiles(dirA);
    const writtenB = writeSeedSqlFiles(dirB);

    expect(writtenB.map((f) => f.file)).toEqual(writtenA.map((f) => f.file));
    for (let i = 0; i < writtenA.length; i++) {
      expect(writtenB[i].sha256).toBe(writtenA[i].sha256);
      expect(readFileSync(writtenB[i].path)).toEqual(readFileSync(writtenA[i].path));
    }
    // The new files ride the same pipeline as the existing two.
    expect(writtenA.map((f) => f.file)).toContain('consumption-norms.d1.sql');
    expect(writtenA.map((f) => f.file)).toContain('carrier-box-types.d1.sql');
  });

  it('carries no wall-clock generation stamps', () => {
    for (const sql of [generateConsumptionNormsSql(), generateCarrierBoxTypesSql()]) {
      expect(sql).not.toMatch(/Generated: \d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('reference seed verification assertions (design D3)', () => {
  const DB_TEST_TIMEOUT_MS = 30_000;

  /**
   * Apply every non-reference seed file (tax rules + staging — the verify
   * query joins those gates too, and staging_reviews is created by
   * staging.d1.sql, not by a migration), leaving the reference tables
   * empty unless seeded by the caller.
   */
  function applyNonReferenceSeeds(db: DatabaseSync): void {
    for (const { name, sql } of generateSeedSqlFiles()) {
      if (name !== 'consumption-norms.d1.sql' && name !== 'carrier-box-types.d1.sql') {
        db.exec(sql);
      }
    }
  }

  it('trip on a database whose reference tables were never seeded', () => {
    const { db } = openMigratedD1();
    applyNonReferenceSeeds(db);
    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    expect(() => assertVerificationRow(row)).toThrow(SeedVerificationError);
    expect(() => assertVerificationRow(row)).toThrow(/consumption_norms_total/);
    expect(() => assertVerificationRow(row)).toThrow(/carrier_box_types_total/);
  }, DB_TEST_TIMEOUT_MS);

  it('trip per dataset: wiping only the norms table fails the norms gate only', () => {
    const { db } = openMigratedD1();
    for (const { sql } of generateSeedSqlFiles()) {
      db.exec(sql);
    }
    db.exec('DELETE FROM consumption_norms');

    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    expect(() => assertVerificationRow(row)).toThrow(/consumption_norms_total/);
    expect(() => assertVerificationRow(row)).not.toThrow(/carrier_box_types_total/);
  }, DB_TEST_TIMEOUT_MS);

  it('pass on a seeded database, and PUBLISHED rows still count toward the gate', () => {
    const { db } = openMigratedD1();
    for (const { sql } of generateSeedSqlFiles()) {
      db.exec(sql);
    }
    db.exec(
      `UPDATE consumption_norms SET status = 'PUBLISHED', confirmed_by = 'owner',
         confirmed_at = '2026-10-03T00:00:00.000Z'
       WHERE event_profile = 'celebration'`,
    );

    const row = db.prepare(buildVerifySql()).get() as Record<string, unknown>;
    // Publication moves rows between the two counted states — the gate
    // counts ACROSS pending/published, so a published environment must
    // never fail the deploy verification.
    expect(() => assertVerificationRow(row)).not.toThrow();
  }, DB_TEST_TIMEOUT_MS);
});

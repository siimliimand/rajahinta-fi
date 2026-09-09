/**
 * Tests for the import-VAT seed (import-vat-rules.seed.ts).
 *
 * Pins three things:
 * 1. No drift — the seed rows are derived from the core-domain dataset
 *    (rates, windows, base composition, labels), never hand-copied.
 * 2. The dataset timeline is gapless and non-overlapping.
 * 3. Idempotency — a present version label is skipped and existing rows
 *    are never touched (append-only dataset policy).
 *
 * The Drizzle db is faked with plain objects matching the query-builder
 * shape seedImportVatRules uses: select().from().where() (awaited) and
 * insert().values() (awaited). The fake exposes no update/delete surface
 * at all — mutation would be impossible even if the code tried.
 *
 * @module Tests/Seed
 */
import { describe, it, expect, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { IMPORT_VAT_DATASET } from '@rajahinta/core-domain/dist/vat';
import { IMPORT_VAT_SEED_RULES, seedImportVatRules } from '../import-vat-rules.seed';
import { validateEffectiveRanges } from '../../repositories/effective-range-validator';
import { IMPORT_VAT_TAX_TYPE, IMPORT_VAT_FORMULA } from '@rajahinta/core-domain/dist/vat';

// ---------------------------------------------------------------------------
// Helpers — fake Drizzle db
// ---------------------------------------------------------------------------

function createFakeDb(presentLabels: string[]): {
  db: PostgresJsDatabase;
  insertedRows: Array<{ versionLabel: string }>;
  insertValuesSpy: ReturnType<typeof vi.fn>;
} {
  const insertedRows: Array<{ versionLabel: string }> = [];
  const insertValuesSpy = vi.fn(async (rows: Array<{ versionLabel: string }>) => {
    insertedRows.push(...rows);
  });

  const db = {
    select() {
      const rows = presentLabels.map((versionLabel) => ({ versionLabel }));
      return {
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      };
    },
    insert: () => ({
      values: insertValuesSpy,
    }),
  };

  return { db: db as unknown as PostgresJsDatabase, insertedRows, insertValuesSpy };
}

// ---------------------------------------------------------------------------
// Drift guard — rows mirror the core-domain dataset
// ---------------------------------------------------------------------------

describe('IMPORT_VAT_SEED_RULES mirror the core-domain dataset', () => {
  it('has exactly one row per dataset version, label = versionId', () => {
    expect(IMPORT_VAT_SEED_RULES).toHaveLength(IMPORT_VAT_DATASET.length);
    for (const version of IMPORT_VAT_DATASET) {
      const row = IMPORT_VAT_SEED_RULES.find((r) => r.versionLabel === version.versionId);
      expect(row, `missing seed row for ${version.versionId}`).toBeDefined();
    }
  });

  it('v1 row: 24.00, window 2013-01-01 → 2024-08-31, base rule embedded', () => {
    const row = IMPORT_VAT_SEED_RULES.find((r) => r.versionLabel === 'import-vat-2024.1');
    expect(row).toBeDefined();
    expect(row!.taxType).toBe(IMPORT_VAT_TAX_TYPE);
    expect(row!.rate).toBe('24.00');
    expect(row!.effectiveFrom).toEqual(new Date('2013-01-01'));
    expect(row!.effectiveTo).toEqual(new Date('2024-08-31'));
    expect(row!.exemptionConditions).toEqual({
      baseComponents: ['retailPrice', 'transport', 'alcoholExcise', 'containerDuty'],
    });
    expect(row!.calculationFormulaReference).toBe(IMPORT_VAT_FORMULA);
    expect(row!.verificationDate).not.toBeNull();
  });

  it('v2 row: 25.50, open-ended from 2024-09-01', () => {
    const row = IMPORT_VAT_SEED_RULES.find((r) => r.versionLabel === 'import-vat-2024.2');
    expect(row).toBeDefined();
    expect(row!.rate).toBe('25.50');
    expect(row!.effectiveFrom).toEqual(new Date('2024-09-01'));
    expect(row!.effectiveTo).toBeNull();
  });

  it('every row window and provenance equals its dataset version', () => {
    for (const version of IMPORT_VAT_DATASET) {
      const row = IMPORT_VAT_SEED_RULES.find((r) => r.versionLabel === version.versionId)!;
      expect(row.effectiveFrom).toEqual(version.effectiveFrom);
      expect(row.effectiveTo).toEqual(version.effectiveTo);
      expect(row.officialSource).toBe(version.officialSource);
      expect(row.verificationDate).toEqual(version.verificationDate);
    }
  });

  it('the version timeline is gapless and non-overlapping', () => {
    expect(
      validateEffectiveRanges(
        IMPORT_VAT_SEED_RULES.map((r) => ({
          effectiveFrom: r.effectiveFrom,
          effectiveTo: r.effectiveTo,
        })),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — present labels skip, nothing mutates
// ---------------------------------------------------------------------------

describe('seedImportVatRules', () => {
  it('inserts only absent labels and reports counts', async () => {
    const { db, insertedRows, insertValuesSpy } = createFakeDb(['import-vat-2024.1']);

    const result = await seedImportVatRules(db);

    expect(result).toEqual({ inserted: 1, skipped: 1 });
    expect(insertValuesSpy).toHaveBeenCalledTimes(1);
    expect(insertedRows.map((r) => r.versionLabel)).toEqual(['import-vat-2024.2']);
  });

  it('skips everything when all labels are present (idempotent re-run)', async () => {
    const { db, insertValuesSpy } = createFakeDb([
      'import-vat-2024.1',
      'import-vat-2024.2',
    ]);

    const result = await seedImportVatRules(db);

    expect(result).toEqual({ inserted: 0, skipped: 2 });
    expect(insertValuesSpy).not.toHaveBeenCalled();
  });

  it('inserts both rows on a fresh database', async () => {
    const { db, insertedRows } = createFakeDb([]);

    const result = await seedImportVatRules(db);

    expect(result).toEqual({ inserted: 2, skipped: 0 });
    expect(insertedRows).toHaveLength(2);
  });
});

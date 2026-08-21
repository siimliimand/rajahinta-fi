/**
 * Unit tests for seedTaxRules per-version row-count mismatch detection
 * (design D5 of the phase0-1-delivery-cleanup change).
 *
 * Covers the three spec scenarios:
 * 1. Same-label correction detected — a present version label with fewer
 *    (or more) rows than SEED_RULES defines produces a mismatch entry, a
 *    console.warn naming the label and both counts, and in strict mode a
 *    throw BEFORE any insert.
 * 2. Complete version skips unchanged — a fully-present label is skipped
 *    with no warning and nothing inserted for it.
 * 3. Strict mode + partially-populated label — the seed fails before
 *    inserting, so drift surfaces at deploy time.
 *
 * The Drizzle db is faked with plain objects matching the query-builder
 * shape seedTaxRules uses: select().from().where() (awaited) and
 * insert().values() (awaited). The two select shapes are disambiguated by
 * the selection keys — the label-exists select asks for { versionLabel },
 * the GROUP BY count select for { versionLabel, rowCount-ish }. Detection
 * never mutates existing rows: the fake exposes no update/delete surface
 * at all, and asserts inserts only ever target absent labels.
 *
 * @module Tests/Seed
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SEED_RULES, seedTaxRules } from '../tax-rules.seed';

// ---------------------------------------------------------------------------
// Helpers — fake Drizzle db
// ---------------------------------------------------------------------------

interface FakeDbConfig {
  /** Rows the label-exists select resolves to: one entry per present label. */
  presentLabels: string[];
  /** Rows the GROUP BY count select resolves to (keyed like the selection). */
  labelCounts: Array<{ versionLabel: string; rowCount: number }>;
}

interface FakeDb {
  db: PostgresJsDatabase;
  /** All rows passed to insert().values(), flattened. */
  insertedRows: Array<{ versionLabel: string }>;
  /** Spy on insert().values() — asserts "nothing inserted" on strict failure. */
  insertValuesSpy: ReturnType<typeof vi.fn>;
}

function createFakeDb(config: FakeDbConfig): FakeDb {
  const insertedRows: Array<{ versionLabel: string }> = [];
  const insertValuesSpy = vi.fn(async (rows: Array<{ versionLabel: string }>) => {
    insertedRows.push(...rows);
  });

  const db = {
    select(selection: Record<string, unknown>) {
      // The mismatch-detection select is the only one selecting an aggregate.
      const isCountSelect = Object.keys(selection).some((k) => k !== 'versionLabel');
      const rows = isCountSelect
        ? config.labelCounts
        : config.presentLabels.map((versionLabel) => ({ versionLabel }));
      // Real Drizzle builders are thenable at every stage and keep exposing
      // methods (.groupBy) after .where — mimic that so both select shapes
      // work: `await …where(…)` and `await …where(…).groupBy(…)`.
      const whereResult = {
        groupBy: async () => rows,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(rows).then(resolve, reject),
      };
      return {
        from: () => ({
          where: () => whereResult,
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
// Env management — save/restore TAX_SEED_STRICT around each test
// ---------------------------------------------------------------------------

const ENV_KEY = 'TAX_SEED_STRICT';
let savedEnvValue: string | undefined;

beforeEach(() => {
  savedEnvValue = process.env[ENV_KEY];
});

afterEach(() => {
  if (savedEnvValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = savedEnvValue;
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedTaxRules row-count mismatch detection (design D5)', () => {
  // Real per-label counts from SEED_RULES (guarded by seed-composition.test.ts):
  // v1.0-2024 = 27, v2.0-2025 = 28, v3.0-2026 = 31, total 86.
  // Scenario under test: v1.0-2024 partially populated (3 of 27 rows),
  // v3.0-2026 complete, v2.0-2025 absent.
  const PARTIAL_DB = {
    presentLabels: ['v1.0-2024', 'v3.0-2026'],
    labelCounts: [
      { versionLabel: 'v1.0-2024', rowCount: 3 },
      { versionLabel: 'v3.0-2026', rowCount: 31 },
    ],
  };

  it('warns and completes when a present label has fewer rows than SEED_RULES (default mode)', async () => {
    delete process.env[ENV_KEY];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, insertedRows } = createFakeDb(PARTIAL_DB);

    const result = await seedTaxRules(db);

    // Mismatch reported in the result, naming label + both counts.
    expect(result.mismatches).toEqual([
      { versionLabel: 'v1.0-2024', present: 3, expected: 27 },
    ]);

    // Warning fired exactly once (the complete label is not warned about),
    // naming the label and both counts.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('v1.0-2024');
    expect(message).toContain('3');
    expect(message).toContain('27');

    // Seed still completes: only the absent v2.0-2025 rules are inserted.
    expect(result.inserted).toBe(28);
    expect(result.skipped).toBe(58);
    expect(insertedRows).toHaveLength(28);
    expect(insertedRows.every((r) => r.versionLabel === 'v2.0-2025')).toBe(true);
  });

  it('throws before inserting when strict mode is enabled and a label is partially populated', async () => {
    process.env[ENV_KEY] = '1';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, insertValuesSpy, insertedRows } = createFakeDb(PARTIAL_DB);

    await expect(seedTaxRules(db)).rejects.toThrow(/v1\.0-2024.*present 3.*expected 27/s);

    // Failed BEFORE any insert — nothing written, drift surfaces at deploy time.
    expect(insertValuesSpy).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });

  it('skips a complete version with no warning and inserts nothing for it', async () => {
    delete process.env[ENV_KEY];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db, insertedRows } = createFakeDb({
      presentLabels: ['v3.0-2026'],
      labelCounts: [{ versionLabel: 'v3.0-2026', rowCount: 31 }],
    });

    const result = await seedTaxRules(db);

    expect(result.mismatches).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    // Only the two absent versions' rules are inserted; v3.0-2026 skipped.
    expect(result.inserted).toBe(SEED_RULES.length - 31);
    expect(result.skipped).toBe(31);
    expect(insertedRows.every((r) => r.versionLabel !== 'v3.0-2026')).toBe(true);
  });

  it('strict mode does not fail a fully-populated database', async () => {
    process.env[ENV_KEY] = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { db } = createFakeDb({
      presentLabels: ['v1.0-2024', 'v2.0-2025', 'v3.0-2026'],
      labelCounts: [
        { versionLabel: 'v1.0-2024', rowCount: 27 },
        { versionLabel: 'v2.0-2025', rowCount: 28 },
        { versionLabel: 'v3.0-2026', rowCount: 31 },
      ],
    });

    const result = await seedTaxRules(db);

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(SEED_RULES.length);
    expect(result.mismatches).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { CalculationRecordRetentionService } from '../calculation-record-retention.service';

// ---------------------------------------------------------------------------
// Test harness — the retention service issues raw SQL through
// db.execute; the fake records every statement and answers scripted
// result rows. Assertions inspect the emitted SQL text.
// ---------------------------------------------------------------------------

interface Executed {
  sql: string;
  rows: unknown;
}

function createFakeDb(respond: (sqlText: string) => unknown) {
  const executed: Executed[] = [];
  const db = {
    async execute(query: unknown) {
      // Every statement this service emits is sql.raw(text); the text
      // lives in the StringChunk values of queryChunks.
      const chunks = (query as { queryChunks: unknown[] }).queryChunks ?? [
        query,
      ];
      const text = chunks
        .map((chunk) =>
          typeof chunk === 'string'
            ? chunk
            : Array.isArray((chunk as { value?: unknown[] }).value)
              ? (chunk as { value: string[] }).value.join('')
              : String(chunk),
        )
        .join('');
      const rows = respond(text);
      executed.push({ sql: text, rows });
      return { rows, rowCount: Array.isArray(rows) ? rows.length : 0 };
    },
  };
  return { db: db as unknown as DrizzleDatabase, executed };
}

const NOW = new Date('2026-08-28T04:30:00.000Z');

describe('CalculationRecordRetentionService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CALCULATION_RECORD_RETENTION_DAYS;
  });

  it('creates current and next two monthly partitions for both tables', async () => {
    const { db, executed } = createFakeDb(() => []);
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });

    const texts = executed.map((e) => e.sql).join('\n');
    for (const table of [
      'calculation_records',
      'basket_calculation_records',
    ]) {
      expect(texts).toContain(`CREATE TABLE ${table}_2026_08`);
      expect(texts).toContain(`CREATE TABLE ${table}_2026_09`);
      expect(texts).toContain(`CREATE TABLE ${table}_2026_10`);
    }
    expect(result.createdPartitions).toContain('calculation_records_2026_08');
    expect(result.createdPartitions).toContain('basket_calculation_records_2026_10');
  });

  it('skips partitions that already exist', async () => {
    const { db, executed } = createFakeDb((text) =>
      text.includes('to_regclass') ? [{ present: true }] : [],
    );
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });
    expect(result.createdPartitions).toHaveLength(0);
    expect(
      executed.filter((e) => e.sql.includes('CREATE TABLE')),
    ).toHaveLength(0);
  });

  it('prunes anonymous rows with the default 30-day cutoff', async () => {
    const { db, executed } = createFakeDb((text) => {
      if (text.includes('WITH deleted')) return [{ count: '5' }];
      return [];
    });
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });

    const expectedCutoff = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(result.cutoff.toISOString()).toBe(expectedCutoff.toISOString());
    expect(result.prunedAnonymous['calculation_records']).toBe(5);

    const pruneStatements = executed
      .map((e) => e.sql)
      .filter((t) => t.includes('WITH deleted'));
    expect(pruneStatements).toHaveLength(2);
    for (const statement of pruneStatements) {
      expect(statement).toContain('session_id IS NULL');
      expect(statement).toContain(expectedCutoff.toISOString());
    }
  });

  it('honours the configured retention window from the environment', async () => {
    process.env.CALCULATION_RECORD_RETENTION_DAYS = '7';
    const { db } = createFakeDb(() => []);
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });
    expect(
      result.cutoff.toISOString(),
    ).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
  });

  it('falls back to the default window on an invalid environment value', async () => {
    process.env.CALCULATION_RECORD_RETENTION_DAYS = 'zero';
    const { db } = createFakeDb(() => []);
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });
    expect(
      result.cutoff.toISOString(),
    ).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString());
  });

  it('drops only fully-expired anonymous-only partitions', async () => {
    const { db, executed } = createFakeDb((text) => {
      if (text.includes('pg_inherits') && text.includes("'calculation_records'")) {
        return [
          {
            name: 'calculation_records_2026_06',
            bound: "FOR VALUES FROM ('2026-06-01 00:00:00') TO ('2026-07-01 00:00:00')",
          },
          {
            // Not fully inside the window — must survive.
            name: 'calculation_records_2026_08',
            bound: "FOR VALUES FROM ('2026-08-01 00:00:00') TO ('2026-09-01 00:00:00')",
          },
        ];
      }
      if (text.includes('session_id IS NOT NULL')) return [{ count: '0' }];
      if (text.includes('WITH deleted')) return [{ count: '0' }];
      return [];
    });
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });

    expect(result.droppedPartitions).toEqual(['calculation_records_2026_06']);
    const texts = executed.map((e) => e.sql);
    expect(texts).toContain('DROP TABLE calculation_records_2026_06');
    expect(texts).not.toContain('DROP TABLE calculation_records_2026_08');
  });

  it('keeps partitions that still hold authenticated rows', async () => {
    const { db, executed } = createFakeDb((text) => {
      if (text.includes('pg_inherits')) {
        return [
          {
            name: 'calculation_records_2026_06',
            bound: "FOR VALUES FROM ('2026-06-01 00:00:00') TO ('2026-07-01 00:00:00')",
          },
        ];
      }
      if (text.includes('session_id IS NOT NULL')) return [{ count: '2' }];
      if (text.includes('WITH deleted')) return [{ count: '0' }];
      return [];
    });
    const service = new CalculationRecordRetentionService(db);
    const result = await service.runRetention({ now: NOW });

    expect(result.droppedPartitions).toEqual([]);
    expect(
      executed.map((e) => e.sql),
    ).not.toContain('DROP TABLE calculation_records_2026_06');
  });
});

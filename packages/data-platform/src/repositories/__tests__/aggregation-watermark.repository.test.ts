import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { DrizzleAggregationWatermarkRepository } from '../aggregation-watermark.repository';

// ---------------------------------------------------------------------------
// Test harness
//
// Package test convention: no-DB unit tests (see
// price-observation-repository.test.ts). The suite captures the exact
// drizzle builder calls the repository makes with a chain stub, then
// REPLAYS them against a real (never-connected) drizzle instance and
// asserts on the generated SQL via `.toSQL()`. pg.Pool connects lazily,
// so no network touch happens; queries are only rendered, never executed.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

/**
 * Chainable db stub: records every builder method call and resolves to
 * `rows` when the builder is awaited.
 */
function createRecordingDb(rows: () => unknown): {
  db: DrizzleDatabase;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const stub: unknown = new Proxy(
    {},
    {
      get(_target, prop, _receiver) {
        if (prop === 'then') {
          return (resolve: unknown, reject: unknown) =>
            Promise.resolve()
              .then(rows)
              .then(resolve as never, reject as never);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return stub;
        };
      },
    },
  );
  return { db: stub as DrizzleDatabase, calls };
}

/** Lazy, never-connected pool — only used to render builders to SQL. */
const renderPool = new Pool({
  connectionString: 'postgres://rajahinta:rajahinta@127.0.0.1:5432/rajahinta_test',
});
const renderDb = drizzle(renderPool);

/** Replay captured builder calls on a real drizzle instance and render SQL. */
function renderSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  let builder: Record<string, unknown> = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    // .apply preserves `this` — drizzle builders are class methods that
    // read this.session / this.config while chaining.
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

function makeRepo(rows: () => unknown): {
  repo: DrizzleAggregationWatermarkRepository;
  calls: RecordedCall[];
} {
  const { db, calls } = createRecordingDb(rows);
  return { repo: new DrizzleAggregationWatermarkRepository(db), calls };
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------

const WATERMARK = new Date('2026-08-26T10:00:00.000Z');

describe('DrizzleAggregationWatermarkRepository', () => {
  describe('find', () => {
    it('reads the watermark by job name', async () => {
      const { repo, calls } = makeRepo(() => [{ watermark: WATERMARK }]);

      const result = await repo.find('time-series-aggregation');

      expect(result).toBe(WATERMARK);
      const { sql, params } = renderSql(calls);
      expect(sql).toContain('select "watermark" from "aggregation_watermarks"');
      expect(sql).toContain('"aggregation_watermarks"."job_name" = $1');
      expect(sql).toContain('limit $2');
      expect(params).toEqual(['time-series-aggregation', 1]);
    });

    it('returns null when the job has never completed a scan', async () => {
      const { repo } = makeRepo(() => []);

      await expect(repo.find('time-series-aggregation')).resolves.toBeNull();
    });
  });

  describe('save', () => {
    it('upserts on job_name with watermark and updatedAt', async () => {
      const { repo, calls } = makeRepo(() => []);

      await repo.save('time-series-aggregation', WATERMARK);

      const { sql, params } = renderSql(calls);
      expect(sql).toContain('insert into "aggregation_watermarks"');
      expect(sql).toContain('on conflict ("job_name") do update set');
      expect(sql).toContain('"watermark" = $');
      expect(sql).toContain('"updated_at" = $');
      const values = calls.find((c) => c.method === 'values')!.args[0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(values).sort()).toEqual(['jobName', 'updatedAt', 'watermark']);
      expect(values.jobName).toBe('time-series-aggregation');
      expect(values.watermark).toBe(WATERMARK);
      expect(values.updatedAt).toBeInstanceOf(Date);
      // Insert params followed by conflict-update params.
      expect(params.slice(0, 3)).toEqual([
        'time-series-aggregation',
        WATERMARK.toISOString(),
        params[2], // updatedAt — asserted by type above, value is now()
      ]);
    });
  });
});

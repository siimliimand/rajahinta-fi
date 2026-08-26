import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import type { PriceHistorySummaryUpsertInput } from '../../abstracts';
import { DrizzlePriceHistorySummaryRepository } from '../price-history-summary.repository';

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

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FROM = '2026-06-01';
const TO = '2026-06-30';

/** One fully computed bucket, as the aggregation worker would emit it. */
const dailyBucket: PriceHistorySummaryUpsertInput = {
  granularity: 'daily',
  periodStart: '2026-06-15',
  productId: 7,
  merchant: 'systembolaget',
  priceOpenCents: 1099,
  priceCloseCents: 1149,
  priceMinCents: 1099,
  priceMaxCents: 1149,
  priceAvgCents: 1124,
  landedCostOpenCents: 2531,
  landedCostCloseCents: 2581,
  landedCostMinCents: 2531,
  landedCostMaxCents: 2581,
  landedCostAvgCents: 2556,
  observationCount: 4,
  strictestReliability: 'ESTIMATED',
};

function makeRepo(rows: () => unknown): {
  repo: DrizzlePriceHistorySummaryRepository;
  calls: RecordedCall[];
} {
  const { db, calls } = createRecordingDb(rows);
  return { repo: new DrizzlePriceHistorySummaryRepository(db), calls };
}

// ---------------------------------------------------------------------------
// upsertBucket — idempotent upsert on the bucket unique key
// ---------------------------------------------------------------------------

describe('DrizzlePriceHistorySummaryRepository.upsertBucket', () => {
  it('inserts into price_history_summaries and returns the assigned id', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 42 }]);

    const result = await repo.upsertBucket(dailyBucket);

    expect(result).toEqual({ id: 42 });
    expect(calls[0].method).toBe('insert');
    const { sql } = renderSql(calls);
    expect(sql).toContain('insert into "price_history_summaries"');
    expect(sql).toContain('returning "id"');
  });

  it('conflicts on the bucket unique key (granularity, period_start, product_id, merchant)', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsertBucket(dailyBucket);

    // The conflict target must be the plain column list of the UNIQUE
    // NULLS NOT DISTINCT constraint — this is what makes a job re-run
    // converge on the existing row instead of duplicating it.
    const { sql } = renderSql(calls);
    expect(sql).toContain(
      'on conflict ("granularity","period_start","product_id","merchant") do update',
    );
  });

  it('overwrites every computed column and never the key columns or id', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsertBucket(dailyBucket);

    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate')!.args[0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflict.target).toHaveLength(4);
    // toEqual asserts the EXACT key set — key columns, id, or any stray
    // field in `set` fails: the key identifies the row, everything else
    // is last-write-wins.
    expect(conflict.set).toEqual({
      priceOpenCents: 1099,
      priceCloseCents: 1149,
      priceMinCents: 1099,
      priceMaxCents: 1149,
      priceAvgCents: 1124,
      landedCostOpenCents: 2531,
      landedCostCloseCents: 2581,
      landedCostMinCents: 2531,
      landedCostMaxCents: 2581,
      landedCostAvgCents: 2556,
      observationCount: 4,
      strictestReliability: 'ESTIMATED',
    });
  });

  it('passes the caller-computed values verbatim (no id column — ids stay db-assigned)', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsertBucket(dailyBucket);

    const values = calls.find((c) => c.method === 'values')!.args[0];
    expect(values).toEqual(dailyBucket);
  });

  it('applies the conflict action unconditionally (no where clause — last write wins)', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsertBucket(dailyBucket);

    // A conditional DO UPDATE (setWhere/targetWhere) would silently keep
    // stale buckets on re-run; idempotent convergence requires the
    // unconditional overwrite. The insert statement has no legitimate
    // where clause, so its total absence is the assertion.
    expect(renderSql(calls).sql).not.toContain('where');
  });

  it('upserts the product-wide bucket (merchant null) through the same column target', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 2 }]);

    await repo.upsertBucket({ ...dailyBucket, merchant: null });

    const values = calls.find((c) => c.method === 'values')!.args[0] as Record<string, unknown>;
    expect(values.merchant).toBeNull();
    // NULLS NOT DISTINCT makes the merchant-NULL row match the same
    // plain-column conflict target — no sentinel value required.
    expect(renderSql(calls).sql).toContain(
      'on conflict ("granularity","period_start","product_id","merchant") do update',
    );
  });
});

// ---------------------------------------------------------------------------
// findByProductRange — closed [from, to] range, binary merchant semantics
// ---------------------------------------------------------------------------

describe('findByProductRange', () => {
  it('reads the product-wide rows (merchant is null) when no merchant is given', async () => {
    const rows = [{ id: 1 }];
    const { repo, calls } = makeRepo(() => rows);

    const result = await repo.findByProductRange(7, 'daily', FROM, TO);

    expect(result).toBe(rows);
    const { sql, params } = renderSql(calls);
    // .select() renders the explicit full column list — assert the table
    // and that every summary column is projected (raw record shape).
    expect(sql).toContain(' from "price_history_summaries"');
    for (const column of [
      'id', 'granularity', 'period_start', 'product_id', 'merchant',
      'price_open_cents', 'price_close_cents', 'price_min_cents',
      'price_max_cents', 'price_avg_cents', 'landed_cost_open_cents',
      'landed_cost_close_cents', 'landed_cost_min_cents',
      'landed_cost_max_cents', 'landed_cost_avg_cents',
      'observation_count', 'strictest_reliability',
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain('"price_history_summaries"."granularity" = $1');
    expect(sql).toContain('"price_history_summaries"."product_id" = $2');
    expect(sql).toContain('"price_history_summaries"."period_start" >= $3');
    expect(sql).toContain('"price_history_summaries"."period_start" <= $4');
    expect(sql).toContain('"price_history_summaries"."merchant" is null');
    expect(params).toEqual(['daily', 7, FROM, TO]);
  });

  it('treats an explicit null merchant identically to an omitted one', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, 'weekly', FROM, TO, null);

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_history_summaries"."merchant" is null');
    expect(params).toEqual(['weekly', 7, FROM, TO]);
  });

  it('filters to the given merchant when one is provided', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, 'daily', FROM, TO, 'alko');

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('"price_history_summaries"."merchant" = $5');
    expect(sql).not.toContain('is null');
    expect(params).toEqual(['daily', 7, FROM, TO, 'alko']);
  });

  it('uses a closed [from, to] interval — the last requested day includes its bucket', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, 'daily', FROM, TO);

    const { sql } = renderSql(calls);
    expect(sql).toContain('"price_history_summaries"."period_start" >= $3');
    expect(sql).toContain('"price_history_summaries"."period_start" <= $4');
  });

  it('orders by period_start ascending, index-aligned with (granularity, product_id, period_start)', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByProductRange(7, 'daily', FROM, TO);

    expect(renderSql(calls).sql).toContain(
      'order by "price_history_summaries"."period_start" asc',
    );
  });
});

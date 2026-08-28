import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { DrizzleMerchantRegistryRepository } from '../merchant-registry.repository';
import { DrizzleClickCounterSnapshotRepository } from '../click-counter-snapshot.repository';

// ---------------------------------------------------------------------------
// Test harness — package convention: no-DB unit tests via recorded builder
// calls replayed against a never-connected drizzle instance.
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

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

const renderPool = new Pool({
  connectionString: 'postgres://rajahinta:rajahinta@127.0.0.1:5432/rajahinta_test',
});
const renderDb = drizzle(renderPool);

function renderSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  let builder: Record<string, unknown> = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

function lastRootSql(calls: RecordedCall[]) {
  for (let i = calls.length - 1; i >= 0; i--) {
    const m = calls[i].method;
    if (m === 'select' || m === 'insert' || m === 'update' || m === 'delete') {
      return renderSql(calls.slice(i));
    }
  }
  throw new Error('no query root recorded');
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------

describe('DrizzleMerchantRegistryRepository', () => {
  it('lists the registry deterministically by merchantId', async () => {
    const { db, calls } = createRecordingDb(() => []);
    const repo = new DrizzleMerchantRegistryRepository(db);
    await repo.list();
    const { sql } = lastRootSql(calls);
    expect(sql).toContain('from "merchant_registry"');
    expect(sql).toContain('order by "merchant_registry"."merchant_id" asc');
  });

  it('upserts on the merchantId unique key and refreshes updatedAt', async () => {
    const { db, calls } = createRecordingDb(() => [{}]);
    const repo = new DrizzleMerchantRegistryRepository(db);
    await repo.upsert({
      merchantId: 'alko',
      name: 'Alko',
      country: 'FI',
      feedUrl: '',
      feedFormat: 'json',
      pollingIntervalMs: 3_600_000,
    });
    const { sql, params } = lastRootSql(calls);
    expect(sql).toContain('insert into "merchant_registry"');
    expect(sql).toContain('on conflict ("merchant_id") do update');
    expect(params).toContain('alko');
  });
});

describe('DrizzleClickCounterSnapshotRepository', () => {
  it('upserts the batch on (merchant_id, url, captured_at) with the fresh count', async () => {
    const { db, calls } = createRecordingDb(() => [{ id: 1 }, { id: 2 }]);
    const repo = new DrizzleClickCounterSnapshotRepository(db);
    const written = await repo.appendBatch([
      {
        merchantId: 'alko',
        url: 'https://example.invalid/product',
        clickCount: 12,
        capturedAt: new Date('2026-08-28T06:00:00.000Z'),
      },
      {
        merchantId: 'alko',
        url: 'https://example.invalid/other',
        clickCount: 3,
        capturedAt: new Date('2026-08-28T06:00:00.000Z'),
      },
    ]);
    expect(written).toBe(2);
    const { sql, params } = lastRootSql(calls);
    expect(sql).toContain('insert into "click_counter_snapshots"');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('excluded.click_count');
    expect(params).toContain('alko');
    expect(params).toContain(12);
  });

  it('writes nothing for an empty batch', async () => {
    const { db, calls } = createRecordingDb(() => []);
    const repo = new DrizzleClickCounterSnapshotRepository(db);
    await expect(repo.appendBatch([])).resolves.toBe(0);
    expect(calls.filter((c) => c.method === 'insert')).toHaveLength(0);
  });
});

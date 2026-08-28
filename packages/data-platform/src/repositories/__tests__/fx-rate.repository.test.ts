import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { DrizzleFxRateRepository } from '../fx-rate.repository';

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
        if (prop === 'transaction') {
          return (fn: (tx: unknown) => Promise<unknown>) => {
            calls.push({ method: 'transaction', args: [] });
            return Promise.resolve(fn(stub));
          };
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

function queryAt(calls: RecordedCall[], rootIndex: number) {
  return chain(calls, rootIndex);
}

function roots(calls: RecordedCall[]): number[] {
  return calls
    .map((c, i) =>
      ['select', 'insert', 'update', 'delete'].includes(c.method) ? i : -1,
    )
    .filter((i) => i >= 0);
}

/** Replay one query chain: from its root up to (excluding) the next root. */
function chain(calls: RecordedCall[], rootIndex: number) {
  const all = roots(calls);
  const next = all.find((i) => i > rootIndex) ?? calls.length;
  return renderSql(calls.slice(rootIndex, next));
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------

const AS_OF = new Date('2026-08-15T12:00:00.000Z');

const PUBLISHED_DATASET = {
  id: 3,
  versionLabel: 'ecb-2026-08-01.1',
  sourceName: 'ecb-reference-rates',
  sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
  referenceDate: '2026-08-01',
  status: 'PENDING_CONFIRMATION',
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
  confirmedBy: null,
  confirmedAt: null,
  createdAt: new Date(),
};

describe('DrizzleFxRateRepository', () => {
  describe('createDataset', () => {
    it('inserts the dataset with rates in one transaction', async () => {
      const { db, calls } = createRecordingDb(() => [PUBLISHED_DATASET]);
      const repo = new DrizzleFxRateRepository(db);
      await repo.createDataset(
        {
          versionLabel: 'ecb-2026-08-01.1',
          sourceName: 'ecb-reference-rates',
          referenceDate: '2026-08-01',
          effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
        },
        [
          { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: '11.290000000000' },
        ],
      );
      expect(calls.some((c) => c.method === 'transaction')).toBe(true);
      const datasetRoot = roots(calls)[0];
      const dataset = queryAt(calls, datasetRoot);
      expect(dataset.sql).toContain('insert into "fx_rate_datasets"');
      // New versions always start unconfirmed — never auto-published.
      expect(dataset.params).toContain('PENDING_CONFIRMATION');
      const rateRoot = roots(calls)[1];
      const rateSql = queryAt(calls, rateRoot).sql;
      expect(rateSql).toContain('insert into "fx_rates"');
    });
  });

  describe('publishDataset', () => {
    it('publishes only a PENDING_CONFIRMATION dataset and stamps the confirmer', async () => {
      const { db, calls } = createRecordingDb(() => [
        { ...PUBLISHED_DATASET, status: 'PUBLISHED', confirmedBy: 'ops@example.invalid' },
      ]);
      const repo = new DrizzleFxRateRepository(db);
      const row = await repo.publishDataset(3, 'ops@example.invalid');
      expect(row).not.toBeNull();
      const [root] = roots(calls);
      const { sql, params } = queryAt(calls, root);
      expect(sql).toContain('update "fx_rate_datasets"');
      expect(sql).toContain('"confirmed_by" = $');
      // Never-auto-publish guard: the UPDATE is constrained to the
      // unconfirmed state, so an already-published version cannot be
      // re-published (two status comparisons: SET and WHERE).
      expect(sql.match(/"status" = \$\d+/g)?.length).toBeGreaterThanOrEqual(2);
      expect(params).toContain('PUBLISHED');
      expect(params).toContain('PENDING_CONFIRMATION');
      expect(params).toContain('ops@example.invalid');
    });

    it('returns null when the row does not match the pending predicate', async () => {
      const { db } = createRecordingDb(() => []);
      const repo = new DrizzleFxRateRepository(db);
      await expect(repo.publishDataset(999, 'ops')).resolves.toBeNull();
    });
  });

  describe('findPublishedDatasetEffectiveOn', () => {
    it('filters PUBLISHED status and the effective window, newest effectiveFrom first', async () => {
      const { db, calls } = createRecordingDb(() => [PUBLISHED_DATASET]);
      const repo = new DrizzleFxRateRepository(db);
      await repo.findPublishedDatasetEffectiveOn(AS_OF);
      const [root] = roots(calls);
      const { sql } = queryAt(calls, root);
      expect(sql).toContain('from "fx_rate_datasets"');
      expect(sql).toContain('"status" = $1');
      expect(sql).toContain('"effective_from" <= $');
      expect(sql).toContain('"effective_to" is null');
      expect(sql).toContain('order by "fx_rate_datasets"."effective_from" desc');
    });
  });

  describe('resolveRate', () => {
    it('resolves through the published effective dataset and coerces the numeric rate', async () => {
      // Per-call row queue: the dataset lookup runs first, the rate
      // select second.
      const queue: unknown[][] = [
        [{ ...PUBLISHED_DATASET, status: 'PUBLISHED' }],
        [
          {
            id: 42,
            datasetId: 3,
            baseCurrency: 'EUR',
            quoteCurrency: 'SEK',
            rate: '11.290000000000',
            createdAt: new Date(),
          },
        ],
      ];
      const { db, calls } = createRecordingDb(() => queue.shift() ?? []);
      const repo = new DrizzleFxRateRepository(db);
      const resolved = await repo.resolveRate('EUR', 'SEK', AS_OF);

      expect(resolved).not.toBeNull();
      expect(resolved!.rate).toBe(11.29);
      expect(resolved!.dataset.id).toBe(3);
      expect(resolved!.baseCurrency).toBe('EUR');
      expect(resolved!.quoteCurrency).toBe('SEK');

      const rateRoot = roots(calls).at(-1)!;
      const { sql } = queryAt(calls, rateRoot);
      expect(sql).toContain('from "fx_rates"');
      expect(sql).toContain('"base_currency" = $');
      expect(sql).toContain('"quote_currency" = $');
    });

    it('returns null when no published dataset covers the date', async () => {
      const { db } = createRecordingDb(() => []);
      const repo = new DrizzleFxRateRepository(db);
      await expect(repo.resolveRate('EUR', 'SEK', AS_OF)).resolves.toBeNull();
    });

    it('returns null when the pair is absent from the dataset', async () => {
      // Dataset lookup finds a row; the rate lookup for NOK finds none.
      const queue: unknown[][] = [
        [{ ...PUBLISHED_DATASET, status: 'PUBLISHED' }],
        [],
      ];
      const { db } = createRecordingDb(() => queue.shift() ?? []);
      const repo = new DrizzleFxRateRepository(db);
      await expect(repo.resolveRate('EUR', 'NOK', AS_OF)).resolves.toBeNull();
    });

    it('throws on a corrupt numeric rate at the repository boundary', async () => {
      const queue: unknown[][] = [
        [{ ...PUBLISHED_DATASET, status: 'PUBLISHED' }],
        [
          {
            id: 42,
            datasetId: 3,
            baseCurrency: 'EUR',
            quoteCurrency: 'SEK',
            rate: 'not-a-number',
            createdAt: new Date(),
          },
        ],
      ];
      const { db } = createRecordingDb(() => queue.shift() ?? []);
      const repo = new DrizzleFxRateRepository(db);
      await expect(repo.resolveRate('EUR', 'SEK', AS_OF)).rejects.toThrow(
        /fx_rates\.rate/,
      );
    });
  });
});

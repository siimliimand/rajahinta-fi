import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import type { SavedScenarioInputs } from '../../abstracts';
import { DrizzleSavedScenarioRepository } from '../saved-scenario.repository';

// ---------------------------------------------------------------------------
// Test harness
//
// Package test convention: no-DB unit tests. The suite captures the exact
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

const scenarioInputs: SavedScenarioInputs = {
  productId: 12,
  quantity: 6,
  destination: 'FI',
  transportMethod: 'posti',
  transportArrangement: 'PERSONAL',
};

function makeRepo(rows: () => unknown): {
  repo: DrizzleSavedScenarioRepository;
  calls: RecordedCall[];
} {
  const { db, calls } = createRecordingDb(rows);
  return { repo: new DrizzleSavedScenarioRepository(db), calls };
}

// ---------------------------------------------------------------------------
// upsert — idempotent save-by-name on the (account_id, name) unique key
// ---------------------------------------------------------------------------

describe('DrizzleSavedScenarioRepository.upsert', () => {
  it('inserts into saved_scenarios and returns the persisted row', async () => {
    const row = { id: 9, accountId: 3, name: 'Weekend run', inputs: scenarioInputs };
    const { repo, calls } = makeRepo(() => [row]);

    const result = await repo.upsert({
      accountId: 3,
      name: 'Weekend run',
      inputs: scenarioInputs,
    });

    expect(result).toBe(row);
    const { sql } = renderSql(calls);
    expect(sql).toContain('insert into "saved_scenarios"');
    expect(sql).toContain('returning');
  });

  it('conflicts on the composite (account_id, name) unique target', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsert({ accountId: 3, name: 'Weekend run', inputs: scenarioInputs });

    // Spec: saving with an existing name for the account replaces the
    // inputs rather than creating a duplicate — this requires the ON
    // CONFLICT target to match the saved_scenarios_account_id_name_unique
    // constraint exactly.
    const { sql } = renderSql(calls);
    expect(sql).toContain('on conflict ("account_id","name") do update');
  });

  it('replaces exactly inputs and updatedAt — never id, accountId, name, or createdAt', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);

    await repo.upsert({ accountId: 3, name: 'Weekend run', inputs: scenarioInputs });

    const conflict = calls.find((c) => c.method === 'onConflictDoUpdate')!.args[0] as {
      target: unknown[];
      set: Record<string, unknown>;
    };
    expect(conflict.target).toHaveLength(2);
    // toEqual asserts the EXACT key set — identity columns, createdAt, or
    // any stray field in `set` fails: the (account, name) pair identifies
    // the row, only the inputs payload (and its refresh timestamp) is
    // last-write-wins.
    expect(conflict.set).toEqual({
      inputs: scenarioInputs,
      updatedAt: expect.any(Date),
    });
  });

  it('passes the caller-supplied values verbatim', async () => {
    const { repo, calls } = makeRepo(() => [{ id: 1 }]);
    const record = { accountId: 3, name: 'Weekend run', inputs: scenarioInputs };

    await repo.upsert(record);

    const values = calls.find((c) => c.method === 'values')!.args[0];
    expect(values).toEqual(record);
  });
});

// ---------------------------------------------------------------------------
// findByAccountId / findByUserId — account-scenario listing
// ---------------------------------------------------------------------------

describe('findByAccountId', () => {
  it('selects all scenario columns for the account', async () => {
    const rows = [{ id: 1 }];
    const { repo, calls } = makeRepo(() => rows);

    const result = await repo.findByAccountId(3);

    expect(result).toBe(rows);
    const { sql, params } = renderSql(calls);
    expect(sql).toContain(' from "saved_scenarios"');
    expect(sql).toContain('"saved_scenarios"."account_id" = $1');
    expect(params).toEqual([3]);
  });
});

describe('findByUserId', () => {
  it('joins accounts on account_id and filters by the external user id', async () => {
    const rows = [{ id: 1 }];
    const { repo, calls } = makeRepo(() => rows);

    const result = await repo.findByUserId('auth0|123');

    expect(result).toBe(rows);
    const { sql, params } = renderSql(calls);
    expect(sql).toContain('inner join "accounts"');
    expect(sql).toContain('"saved_scenarios"."account_id" = "accounts"."id"');
    expect(sql).toContain('"accounts"."user_id" = $1');
    expect(params).toEqual(['auth0|123']);
  });

  it('projects the scenario columns flat — not the nested join shape', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.findByUserId('auth0|123');

    const select = calls.find((c) => c.method === 'select')!.args[0] as Record<string, unknown>;
    // The explicit projection is what keeps the return type the raw
    // saved_scenarios record shape over an innerJoin.
    expect(Object.keys(select)).toEqual([
      'id',
      'accountId',
      'name',
      'inputs',
      'createdAt',
      'updatedAt',
    ]);
  });
});

// ---------------------------------------------------------------------------
// delete — pk-keyed, account-scoped
// ---------------------------------------------------------------------------

describe('delete', () => {
  it('deletes by id AND owning account — never another account’s scenario', async () => {
    const { repo, calls } = makeRepo(() => []);

    await repo.delete(3, 7);

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('delete from "saved_scenarios"');
    expect(sql).toContain('"saved_scenarios"."id" = $1');
    expect(sql).toContain('"saved_scenarios"."account_id" = $2');
    expect(params).toEqual([7, 3]);
  });
});

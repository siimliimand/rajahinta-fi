import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { DrizzleSessionRepository } from '../session.repository';

// ---------------------------------------------------------------------------
// Test harness — package convention: no-DB unit tests. Builder calls are
// recorded with a chain stub and replayed against a never-connected
// drizzle instance; assertions run on the rendered SQL. `transaction` is
// recorded too (the callback receives the same stub), so the rotate
// sequence is assertable.
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

function rootIndexes(calls: RecordedCall[]): number[] {
  return calls
    .map((c, i) =>
      ['select', 'insert', 'update', 'delete'].includes(c.method) ? i : -1,
    )
    .filter((i) => i >= 0);
}

/** Replay one query chain: from its root up to (excluding) the next root. */
function chain(calls: RecordedCall[], rootIndex: number) {
  const next =
    rootIndexes(calls).find((i) => i > rootIndex) ?? calls.length;
  return renderSql(calls.slice(rootIndex, next));
}

function lastSql(calls: RecordedCall[]): { sql: string; params: unknown[] } {
  const all = rootIndexes(calls);
  if (all.length === 0) throw new Error('no query root recorded');
  return chain(calls, all[all.length - 1]);
}

afterAll(async () => {
  await renderPool.end();
});

// ---------------------------------------------------------------------------

const TOKEN_HASH =
  'a'.repeat(64);
const NEW_TOKEN_HASH =
  'b'.repeat(64);

describe('DrizzleSessionRepository', () => {
  describe('create', () => {
    it('inserts the hash, account, and expiry', async () => {
      const { db, calls } = createRecordingDb(() => [{}]);
      const repo = new DrizzleSessionRepository(db);
      await repo.create({
        tokenHash: TOKEN_HASH,
        accountId: 7,
        expiresAt: new Date('2026-09-27T00:00:00.000Z'),
      });
      const { sql, params } = lastSql(calls);
      expect(sql).toContain('insert into "sessions"');
      expect(sql).toContain('"token_hash"');
      expect(params).toContain(TOKEN_HASH);
      expect(params).toContain(7);
    });
  });

  describe('findActiveByTokenHash', () => {
    it('filters on the hash, unrevoked, and unexpired', async () => {
      const { db, calls } = createRecordingDb(() => []);
      const repo = new DrizzleSessionRepository(db);
      await repo.findActiveByTokenHash(TOKEN_HASH);
      const { sql, params } = lastSql(calls);
      expect(sql).toContain('from "sessions"');
      expect(sql).toContain('"token_hash" = $1');
      expect(sql).toContain('"revoked_at" is null');
      expect(sql).toContain('"expires_at" > $');
      expect(params).toContain(TOKEN_HASH);
    });
  });

  describe('rotate', () => {
    it('inserts the successor then revokes the predecessor inside one transaction', async () => {
      const existingRow = {
        id: 11,
        tokenHash: TOKEN_HASH,
        accountId: 7,
        rotatedFromId: null,
        createdAt: new Date(),
        expiresAt: new Date('2026-09-27T00:00:00.000Z'),
        revokedAt: null,
      };
      const { db, calls } = createRecordingDb(() => [existingRow]);
      const repo = new DrizzleSessionRepository(db);
      const result = await repo.rotate(
        TOKEN_HASH,
        NEW_TOKEN_HASH,
        new Date('2026-10-27T00:00:00.000Z'),
      );

      // The stub returns the SAME row object for every query, so the
      // returned successor here is the "existing" row — what matters is
      // the recorded statement sequence.
      expect(result).not.toBeNull();
      expect(calls.some((c) => c.method === 'transaction')).toBe(true);

      const insertIndex = calls.findIndex((c) => c.method === 'insert');
      expect(insertIndex).toBeGreaterThan(-1);

      const updateIndex = calls.findIndex(
        (c, i) => c.method === 'update' && i > insertIndex,
      );
      expect(updateIndex).toBeGreaterThan(insertIndex);

      const insert = chain(calls, insertIndex);
      expect(insert.sql).toContain('"rotated_from_id"');
      expect(insert.params).toContain(NEW_TOKEN_HASH);

      const update = chain(calls, updateIndex);
      expect(update.sql).toContain('update "sessions"');
      expect(update.sql).toContain('"revoked_at"');
    });

    it('returns null without inserting when no active session matches', async () => {
      const { db, calls } = createRecordingDb(() => []);
      const repo = new DrizzleSessionRepository(db);
      const result = await repo.rotate(TOKEN_HASH, NEW_TOKEN_HASH, new Date());
      expect(result).toBeNull();
      expect(calls.filter((c) => c.method === 'insert')).toHaveLength(0);
    });
  });

  describe('revokeByTokenHash', () => {
    it('updates revoked_at only for the active predicate', async () => {
      const { db, calls } = createRecordingDb(() => [{ id: 11 }]);
      const repo = new DrizzleSessionRepository(db);
      await expect(repo.revokeByTokenHash(TOKEN_HASH)).resolves.toBe(true);
      const { sql } = lastSql(calls);
      expect(sql).toContain('update "sessions"');
      expect(sql).toContain('"revoked_at"');
      expect(sql).toContain('"expires_at" > $');
    });

    it('reports false when nothing was revoked', async () => {
      const { db } = createRecordingDb(() => []);
      const repo = new DrizzleSessionRepository(db);
      await expect(repo.revokeByTokenHash(TOKEN_HASH)).resolves.toBe(false);
    });
  });

  describe('deleteExpiredBefore', () => {
    it('deletes by expiry cutoff and returns the count', async () => {
      const { db, calls } = createRecordingDb(() => [{ id: 1 }, { id: 2 }]);
      const repo = new DrizzleSessionRepository(db);
      await expect(
        repo.deleteExpiredBefore(new Date('2026-08-01T00:00:00.000Z')),
      ).resolves.toBe(2);
      const { sql } = lastSql(calls);
      expect(sql).toContain('delete from "sessions"');
      expect(sql).toContain('"expires_at" < $1');
    });
  });
});

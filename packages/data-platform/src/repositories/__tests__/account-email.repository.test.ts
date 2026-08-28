/**
 * DrizzleAccountRepository.setVerifiedEmail tests (FIX-E, change
 * technical-assessment-remediation).
 *
 * Pins the email-verification write contract: a targeted UPDATE on the
 * documented verified-email column keyed by userId, and an explicit
 * throw (never a silent no-op) when the account does not exist — a
 * silent success would lose the verification.
 *
 * Package convention: recorded builder calls replayed against a
 * never-connected drizzle instance, so no TEST_DATABASE_URL is needed.
 *
 * @module DrizzleAccountRepositoryEmailTest
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { DrizzleDatabase } from '../../db/drizzle.provider';
import { DrizzleAccountRepository } from '../account.repository';

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
  let builder = renderDb as unknown as Record<string, unknown>;
  for (const { method, args } of calls) {
    const fn = builder[method] as (...a: unknown[]) => unknown;
    builder = fn.apply(builder, args) as Record<string, unknown>;
  }
  return (builder as unknown as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

afterAll(async () => {
  await renderPool.end();
});

describe('DrizzleAccountRepository.setVerifiedEmail', () => {
  it('updates only the email column of the addressed account row', async () => {
    const { db, calls } = createRecordingDb(() => [{ id: 42 }]);
    const repo = new DrizzleAccountRepository(db);

    await repo.setVerifiedEmail('user-123', 'verified@example.invalid');

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('update "accounts"');
    expect(sql).toContain('"email" = $');
    expect(sql).toContain('"user_id" = $');
    expect(params).toContain('user-123');
    expect(params).toContain('verified@example.invalid');
  });

  it('throws when no account exists for the userId — verification is never silently dropped', async () => {
    const { db } = createRecordingDb(() => []);
    const repo = new DrizzleAccountRepository(db);

    await expect(
      repo.setVerifiedEmail('missing-user', 'verified@example.invalid'),
    ).rejects.toThrow(/account not found/i);
  });
});

/**
 * DrizzleAccountRepository — credential-surface tests (task 1.1, change
 * email-password-auth).
 *
 * Pins the contract the login path codes against: findByEmail resolves
 * the case-insensitive lower(email) form and projects the row with
 * truthful null credential fields (the legacy pg schema has no
 * credential columns), and the credential WRITES reject loudly — the
 * production credential flow lives only in the D1 repository (design
 * D9).
 *
 * Package convention: recorded builder calls replayed against a
 * never-connected drizzle instance, so no TEST_DATABASE_URL is needed.
 *
 * @module DrizzleAccountRepositoryCredentialTest
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

describe('DrizzleAccountRepository.findByEmail', () => {
  it('resolves the case-insensitive lower(email) form with a normalized parameter', async () => {
    const { db, calls } = createRecordingDb(() => []);
    const repo = new DrizzleAccountRepository(db);

    await repo.findByEmail('Mixed.Case@Example.INVALID');

    const { sql, params } = renderSql(calls);
    expect(sql).toContain('select');
    expect(sql).toContain('from "accounts"');
    expect(sql).toContain('lower("accounts"."email")');
    // First bind is the normalized address (a later bind is the limit).
    expect(params[0]).toBe('mixed.case@example.invalid');
  });

  it('projects the credential record with truthful null credential fields', async () => {
    const row = {
      id: 7,
      userId: 'user-7',
      email: 'user-7@example.invalid',
      tier: 'FREE',
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const { db } = createRecordingDb(() => [row]);
    const repo = new DrizzleAccountRepository(db);

    const record = await repo.findByEmail('user-7@example.invalid');

    expect(record).not.toBeNull();
    expect(record!.id).toBe(7);
    expect(record!.userId).toBe('user-7');
    expect(record!.email).toBe('user-7@example.invalid');
    // No credential columns exist in the pg harness schema — nulls are
    // the truthful projection, and login treats them as fail-safe 401.
    expect(record!.passwordHash).toBeNull();
    expect(record!.emailVerifiedAt).toBeNull();
  });

  it('returns null for an unknown address', async () => {
    const { db } = createRecordingDb(() => []);
    const repo = new DrizzleAccountRepository(db);

    await expect(repo.findByEmail('nobody@example.invalid')).resolves.toBeNull();
  });
});

describe('DrizzleAccountRepository credential writes', () => {
  it('setPasswordHash rejects — the credential flow lives only in the API Worker (D9)', async () => {
    const { db } = createRecordingDb(() => [{ id: 42 }]);
    const repo = new DrizzleAccountRepository(db);

    await expect(
      repo.setPasswordHash('user-123', 'pbkdf2-sha256$600000$s$h'),
    ).rejects.toThrow(/not supported by the legacy pg harness/);
  });

  it('setVerifiedEmail rejects — verification state exists only in the D1 schema (D9)', async () => {
    const { db } = createRecordingDb(() => [{ id: 42 }]);
    const repo = new DrizzleAccountRepository(db);

    await expect(
      repo.setVerifiedEmail('user-123', new Date(0)),
    ).rejects.toThrow(/not supported by the legacy pg harness/);
  });
});

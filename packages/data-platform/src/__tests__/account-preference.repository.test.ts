/**
 * D1 account-preference repository — real-SQLite tests (task 1.2,
 * change add-onboarding-preferences). Covers the unanswered-shape read
 * (get-absent), the sparse partial-update merge (design D2), the
 * element-wise category-tag validation against PRODUCT_CATEGORIES
 * (design D7, the domain error the route maps to 400), reset's
 * row-preserving clear, the account_id cascade (GDPR erasure,
 * migration 0031), and the task-4.2 digest-consent enumeration
 * (`listDigestConsents` — consent flag in SQL, the sweep's remaining
 * eligibility conditions live in the cron handler's predicate).
 *
 * Harness note: the shared `openMigratedD1()` harness cannot apply the
 * committed migration stack in this environment — node:sqlite ships
 * without the FTS5 module migration 0001 requires (pre-existing
 * limitation hitting every openMigratedD1 suite here). The two tables
 * under test are therefore created directly, with the
 * account_preferences DDL byte-for-byte migration 0031's; the D1
 * binding shape still comes from the shared harness shim, so the
 * repository exercises the exact prepare/bind/first surface it runs on
 * in production.
 *
 * @module D1AccountPreferencesRepositoryTest
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createD1Shim } from '../repositories/d1/__tests__/d1-test-harness';
import type { D1DatabaseLike } from '../d1/executor';
import {
  D1AccountPreferencesRepository,
  InvalidChannelError,
  UnknownCategoryTagError,
  unansweredAccountPreferences,
} from '../repositories/d1/account-preference.repository';
import { PRODUCT_CATEGORIES } from '../d1/schema';

/** Minimal parent for the FK — only the columns the repository touches. */
const ACCOUNTS_DDL = `
  CREATE TABLE accounts (
    id integer PRIMARY KEY,
    user_id text UNIQUE NOT NULL,
    email text NOT NULL,
    email_verified_at text
  )`;

/** Byte-for-byte migration 0031_account_preferences.sql. */
const ACCOUNT_PREFERENCES_DDL = `
  CREATE TABLE account_preferences (
    id integer PRIMARY KEY NOT NULL,
    account_id integer NOT NULL,
    channel text,
    category_tags text DEFAULT '[]' NOT NULL,
    digest_enabled integer DEFAULT false NOT NULL,
    onboarded_at text,
    created_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    updated_at text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON UPDATE no action ON DELETE cascade,
    CONSTRAINT account_preferences_channel_check CHECK(channel IS NULL OR channel IN ('TRAVEL', 'DELIVERY', 'BOTH')),
    CONSTRAINT account_preferences_digest_enabled_check CHECK(digest_enabled IN (0, 1))
  )`;

let db: DatabaseSync;
let d1: D1DatabaseLike;
let preferences: D1AccountPreferencesRepository;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(ACCOUNTS_DDL);
  db.exec(ACCOUNT_PREFERENCES_DDL);
  db.exec(
    'CREATE UNIQUE INDEX account_preferences_account_id_unique ON account_preferences (account_id)',
  );
  d1 = createD1Shim(db);
  preferences = new D1AccountPreferencesRepository(d1);
});

let accountIdSeq = 500;
function seedAccount(): number {
  const id = ++accountIdSeq;
  db.prepare(`INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`).run(
    id,
    `user-${id}@test.invalid`,
    `user-${id}@test.invalid`,
  );
  return id;
}

function storedRowCount(): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM account_preferences`).get() as {
      n: number;
    }
  ).n;
}

describe('D1AccountPreferencesRepository.getByAccount', () => {
  it('answers the unanswered shape for an account without a row — without creating one', async () => {
    const accountId = seedAccount();

    const view = await preferences.getByAccount(accountId);

    expect(view).toEqual(unansweredAccountPreferences(accountId));
    expect(view.channel).toBeNull();
    expect(view.categoryTags).toEqual([]);
    expect(view.digestEnabled).toBe(false);
    expect(view.onboardedAt).toBeNull();
    expect(storedRowCount()).toBe(0);
  });

  it('returns the stored row with ISO instants converted to Dates', async () => {
    const accountId = seedAccount();
    const completedAt = new Date('2026-10-10T09:30:00.000Z');
    await preferences.put(accountId, {
      channel: 'BOTH',
      categoryTags: ['wine_still'],
      digestEnabled: true,
      onboardedAt: completedAt,
    });

    const view = await preferences.getByAccount(accountId);

    expect('id' in view).toBe(true);
    if (!('id' in view)) throw new Error('expected the stored-row shape');
    expect(view.accountId).toBe(accountId);
    expect(view.channel).toBe('BOTH');
    expect(view.categoryTags).toEqual(['wine_still']);
    expect(view.digestEnabled).toBe(true);
    expect(view.onboardedAt).toEqual(completedAt);
    expect(view.createdAt).toBeInstanceOf(Date);
    expect(view.updatedAt).toBeInstanceOf(Date);
  });
});

describe('D1AccountPreferencesRepository.put (design D2 partial-update semantics)', () => {
  it('creates the row on first write, unspecified fields at their defaults', async () => {
    const accountId = seedAccount();

    const row = await preferences.put(accountId, { channel: 'TRAVEL' });

    expect(row.accountId).toBe(accountId);
    expect(row.id).toBeGreaterThan(0);
    expect(row.channel).toBe('TRAVEL');
    expect(row.categoryTags).toEqual([]);
    expect(row.digestEnabled).toBe(false);
    expect(row.onboardedAt).toBeNull();
    expect(storedRowCount()).toBe(1);
  });

  it('retains unspecified fields across writes and bumps only updated_at', async () => {
    const accountId = seedAccount();
    const first = await preferences.put(accountId, {
      channel: 'DELIVERY',
      categoryTags: ['spirits'],
      digestEnabled: true,
    });

    const second = await preferences.put(accountId, { digestEnabled: false });

    expect(second.id).toBe(first.id); // same row, updated in place
    expect(second.channel).toBe('DELIVERY'); // retained
    expect(second.categoryTags).toEqual(['spirits']); // retained
    expect(second.digestEnabled).toBe(false); // the patched field
    expect(second.createdAt).toEqual(first.createdAt);
    expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(
      first.updatedAt.getTime(),
    );
    expect(storedRowCount()).toBe(1); // the UNIQUE(account_id) guard, never a second row
  });

  it('lets an explicit null clear an answer back to unanswered (design D8)', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, { channel: 'BOTH' });

    const row = await preferences.put(accountId, { channel: null });

    expect(row.channel).toBeNull();
  });

  it('accepts every canonical category and round-trips the stored order', async () => {
    const accountId = seedAccount();

    for (const category of PRODUCT_CATEGORIES) {
      const row = await preferences.put(accountId, { categoryTags: [category] });
      expect(row.categoryTags).toEqual([category]);
    }

    const all = await preferences.put(accountId, {
      categoryTags: [...PRODUCT_CATEGORIES].reverse(),
    });
    expect(all.categoryTags).toEqual([...PRODUCT_CATEGORIES].reverse());
  });

  it('stores an empty tag array — following no category is a valid answer (design D7)', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, { categoryTags: ['beer'] });

    const row = await preferences.put(accountId, { categoryTags: [] });

    expect(row.categoryTags).toEqual([]);
  });
});

describe('D1AccountPreferencesRepository.put tag validation (design D7, the 400 shape)', () => {
  it('rejects an unknown tag with the domain error naming the valid vocabulary', async () => {
    const accountId = seedAccount();

    await expect(
      preferences.put(accountId, { categoryTags: ['beer', 'nail_polish' as never] }),
    ).rejects.toThrowError(UnknownCategoryTagError);
  });

  it('validates before any write — a rejected patch leaves no row and no partial merge', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, { channel: 'TRAVEL', digestEnabled: true });

    await expect(
      preferences.put(accountId, {
        categoryTags: ['nope' as never],
      }),
    ).rejects.toThrowError(UnknownCategoryTagError);

    const view = await preferences.getByAccount(accountId);
    // The earlier answers are untouched — the invalid patch changed nothing.
    expect(view.channel).toBe('TRAVEL');
    expect(view.digestEnabled).toBe(true);
    expect(view.categoryTags).toEqual([]);
  });

  it('rejects a channel outside the closed set with its domain error', async () => {
    const accountId = seedAccount();

    await expect(
      preferences.put(accountId, {
        channel: 'SUBMARINE' as never,
      }),
    ).rejects.toThrowError(InvalidChannelError);
  });
});

describe('D1AccountPreferencesRepository.reset (design D2/D6)', () => {
  it('clears every answer but keeps the row — same id, created_at preserved', async () => {
    const accountId = seedAccount();
    const first = await preferences.put(accountId, {
      channel: 'BOTH',
      categoryTags: ['beer', 'wine_sparkling'],
      digestEnabled: true,
      onboardedAt: new Date('2026-10-10T10:00:00.000Z'),
    });

    const row = await preferences.reset(accountId);

    expect('id' in row).toBe(true);
    if (!('id' in row)) throw new Error('reset on an existing row keeps the row shape');
    expect(row.id).toBe(first.id);
    expect(row.createdAt).toEqual(first.createdAt);
    expect(row.channel).toBeNull();
    expect(row.categoryTags).toEqual([]);
    expect(row.digestEnabled).toBe(false);
    expect(row.onboardedAt).toBeNull();
    expect(storedRowCount()).toBe(1);

    // The stored row reads back as unanswered fields on the record shape.
    const reread = await preferences.getByAccount(accountId);
    expect(reread.channel).toBeNull();
    expect(reread.digestEnabled).toBe(false);
    expect(reread.onboardedAt).toBeNull();
  });

  it('answers the unanswered shape for an account without a row — without creating one', async () => {
    const accountId = seedAccount();

    const view = await preferences.reset(accountId);

    expect(view).toEqual(unansweredAccountPreferences(accountId));
    expect(storedRowCount()).toBe(0);
  });
});

describe('D1AccountPreferencesRepository cascade (GDPR erasure, migration 0031)', () => {
  it('deletes the preference row when the account row is deleted', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, {
      channel: 'TRAVEL',
      categoryTags: ['beer'],
      digestEnabled: true,
      onboardedAt: new Date('2026-10-10T10:00:00.000Z'),
    });
    expect(storedRowCount()).toBe(1);

    db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);

    expect(storedRowCount()).toBe(0);
    expect(await preferences.getByAccount(accountId)).toEqual(
      unansweredAccountPreferences(accountId),
    );
  });
});

describe('D1AccountPreferencesRepository.listDigestConsents (task 4.2 enumeration)', () => {
  /** Mark an account's address verified (the sweep's verified-address gate). */
  function verifyEmail(accountId: number, at: string): void {
    db.prepare(`UPDATE accounts SET email_verified_at = ? WHERE id = ?`).run(
      at,
      accountId,
    );
  }

  it('answers an empty list when no account has consented', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, { categoryTags: ['beer'] }); // consent defaults false

    expect(await preferences.listDigestConsents()).toEqual([]);
  });

  it('enumerates only digest_enabled = 1 rows — the consent flag is the SQL filter', async () => {
    const consented = seedAccount();
    await preferences.put(consented, {
      categoryTags: ['beer'],
      digestEnabled: true,
      onboardedAt: new Date('2026-10-05T08:00:00.000Z'),
    });
    verifyEmail(consented, '2026-10-01T08:00:00.000Z');
    const revoked = seedAccount();
    await preferences.put(revoked, {
      categoryTags: ['spirits'],
      digestEnabled: true,
    });
    await preferences.put(revoked, { digestEnabled: false }); // consent withdrawn
    const neverAsked = seedAccount(); // no preference row at all

    const rows = await preferences.listDigestConsents();

    expect(rows.map((row) => row.accountId)).toEqual([consented]);
    expect(rows.map((row) => row.accountId)).not.toContain(revoked);
    expect(rows.map((row) => row.accountId)).not.toContain(neverAsked);
  });

  it('carries the joined contact address, its verification instant, tags, and onboarding', async () => {
    const accountId = seedAccount();
    const verifiedAt = new Date('2026-10-01T08:00:00.000Z');
    const onboardedAt = new Date('2026-10-05T08:00:00.000Z');
    verifyEmail(accountId, verifiedAt.toISOString());
    await preferences.put(accountId, {
      categoryTags: ['wine_still', 'beer'],
      digestEnabled: true,
      onboardedAt,
    });

    const [row] = await preferences.listDigestConsents();

    expect(row).toBeDefined();
    expect(row!.email).toBe(`user-${accountId}@test.invalid`);
    expect(row!.emailVerifiedAt).toEqual(verifiedAt);
    expect(row!.categoryTags).toEqual(['wine_still', 'beer']);
    expect(row!.onboardedAt).toEqual(onboardedAt);
  });

  it('reports a null emailVerifiedAt for a consented but unverified account — the cron skips it', async () => {
    const accountId = seedAccount();
    await preferences.put(accountId, {
      categoryTags: ['beer'],
      digestEnabled: true,
      onboardedAt: new Date('2026-10-05T08:00:00.000Z'),
    });

    const [row] = await preferences.listDigestConsents();

    expect(row).toBeDefined();
    expect(row!.emailVerifiedAt).toBeNull();
  });
});

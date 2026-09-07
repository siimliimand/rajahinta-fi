/**
 * D1AccountRepository — real-SQLite tests (task 1.1, change
 * email-password-auth) on the node:sqlite harness with the committed
 * migrations applied. Pins the credential-account semantics at the
 * storage boundary: email is the username (lowercased on write and
 * lookup, unique via the lower(email) index), the password envelope and
 * the verification instant are write-through dedicated methods that
 * throw on a missing account (a silent no-op would lose the
 * credential), and anonymize retires credentials along with the
 * identifiers.
 *
 * @module D1AccountRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1AccountRepository } from '../account.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1AccountRepository(d1);

const VERIFIED_INSTANT = new Date('2026-09-01T12:00:00.000Z');

describe('D1AccountRepository.create', () => {
  it('stores the email lowercased — the username is canonical before uniqueness ever applies', async () => {
    const row = await repo.create({
      userId: 'user-create-1',
      email: 'Mixed.Case@Example.INVALID',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.email).toBe('mixed.case@example.invalid');
    expect(row.tier).toBe('FREE');

    const stored = db
      .prepare('SELECT email, password_hash, email_verified_at FROM accounts WHERE id = ?')
      .get(row.id) as { email: string; password_hash: string | null; email_verified_at: string | null };
    expect(stored.email).toBe('mixed.case@example.invalid');
    // A fresh account carries no credential and no verification claim.
    expect(stored.password_hash).toBeNull();
    expect(stored.email_verified_at).toBeNull();
  });

  it('rejects a case-variant duplicate — uniqueness is the lower(email) index, in SQL', async () => {
    await repo.create({ userId: 'user-uniq-a', email: 'user-uniq@example.invalid' });

    await expect(
      repo.create({ userId: 'user-uniq-b', email: 'USER-UNIQ@example.invalid' }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });
});

describe('D1AccountRepository.findByEmail', () => {
  it('resolves an account by address regardless of the presentation case', async () => {
    await repo.create({ userId: 'user-find-1', email: 'find-me@example.invalid' });

    for (const email of ['find-me@example.invalid', 'FIND-ME@EXAMPLE.INVALID', 'Find-Me@Example.Invalid']) {
      const record = await repo.findByEmail(email);
      expect(record).not.toBeNull();
      expect(record!.userId).toBe('user-find-1');
      expect(record!.passwordHash).toBeNull();
      expect(record!.emailVerifiedAt).toBeNull();
    }
  });

  it('surfaces the stored credential state — the login projection', async () => {
    await repo.create({ userId: 'user-find-2', email: 'cred@example.invalid' });
    await repo.setPasswordHash('user-find-2', 'pbkdf2-sha256$600000$c2FsdA$aGFzaA');
    await repo.setVerifiedEmail('user-find-2', VERIFIED_INSTANT);

    const record = await repo.findByEmail('CRED@example.invalid');
    expect(record!.passwordHash).toBe('pbkdf2-sha256$600000$c2FsdA$aGFzaA');
    expect(record!.emailVerifiedAt!.toISOString()).toBe(VERIFIED_INSTANT.toISOString());
  });

  it('returns null for an unknown address — never a guessed identity', async () => {
    await expect(repo.findByEmail('nobody@example.invalid')).resolves.toBeNull();
  });
});

describe('D1AccountRepository.setPasswordHash / setVerifiedEmail', () => {
  it('writes the password envelope verbatim', async () => {
    await repo.create({ userId: 'user-write-1', email: 'write-1@example.invalid' });

    await repo.setPasswordHash('user-write-1', 'pbkdf2-sha256$600000$c2FsdA$aGFzaA');

    const stored = db
      .prepare('SELECT password_hash FROM accounts WHERE user_id = ?')
      .get('user-write-1') as { password_hash: string };
    expect(stored.password_hash).toBe('pbkdf2-sha256$600000$c2FsdA$aGFzaA');
  });

  it('writes the verification instant as ISO-8601 TEXT', async () => {
    await repo.create({ userId: 'user-write-2', email: 'write-2@example.invalid' });

    await repo.setVerifiedEmail('user-write-2', VERIFIED_INSTANT);

    const stored = db
      .prepare('SELECT email_verified_at FROM accounts WHERE user_id = ?')
      .get('user-write-2') as { email_verified_at: string };
    expect(stored.email_verified_at).toBe(VERIFIED_INSTANT.toISOString());
  });

  it('throws when no account exists — a verification or credential is never silently dropped', async () => {
    await expect(
      repo.setPasswordHash('missing-user', 'pbkdf2-sha256$600000$s$h'),
    ).rejects.toThrow(/account not found/);
    await expect(
      repo.setVerifiedEmail('missing-user', VERIFIED_INSTANT),
    ).rejects.toThrow(/account not found/);
  });
});

describe('D1AccountRepository.anonymize', () => {
  it('overwrites the identifiers and retires the credential state atomically', async () => {
    const created = await repo.create({ userId: 'user-anon-1', email: 'anon-1@example.invalid' });
    await repo.setPasswordHash('user-anon-1', 'pbkdf2-sha256$600000$s$h');
    await repo.setVerifiedEmail('user-anon-1', VERIFIED_INSTANT);
    db.prepare(
      `INSERT INTO saved_baskets (account_id, name, items) VALUES (?, 'basket', '[]')`,
    ).run(created.id);
    db.prepare(
      `INSERT INTO saved_scenarios (account_id, name, inputs) VALUES (?, 'scenario', '{}')`,
    ).run(created.id);

    await repo.anonymize('user-anon-1');

    const row = db
      .prepare(
        `SELECT user_id, email, password_hash, email_verified_at, tier
           FROM accounts WHERE id = ?`,
      )
      .get(created.id) as {
      user_id: string;
      email: string;
      password_hash: string | null;
      email_verified_at: string | null;
      tier: string;
    };
    // Irreversible pseudonyms — nothing derivable from the originals.
    expect(row.user_id).toMatch(/^anon_[0-9a-f-]{36}$/);
    expect(row.user_id).not.toContain('user-anon-1');
    expect(row.email).toMatch(/^anonymized\+[0-9a-f-]{36}@deleted\.invalid$/);
    // The skeleton keeps no credential and no verification claim.
    expect(row.password_hash).toBeNull();
    expect(row.email_verified_at).toBeNull();
    expect(row.tier).toBe('FREE');

    expect(
      (db.prepare('SELECT count(*) AS n FROM saved_baskets WHERE account_id = ?').get(created.id) as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT count(*) AS n FROM saved_scenarios WHERE account_id = ?').get(created.id) as { n: number }).n,
    ).toBe(0);
  });

  it('throws when no account exists — erasure is never a silent no-op', async () => {
    await expect(repo.anonymize('missing-user')).rejects.toThrow(/account not found/);
  });
});

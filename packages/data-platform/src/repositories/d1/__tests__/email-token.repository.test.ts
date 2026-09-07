/**
 * D1EmailTokenRepository — real-SQLite tests (task 1.1, change
 * email-password-auth) on the node:sqlite harness with the committed
 * migrations applied. Pins the D3 security semantics at the storage
 * boundary: hash-only at rest, purpose scoping (a token can never
 * redeem a different flow), single-use consumption where `used_at` and
 * the active check are one statement (replay loses), expiry, and the
 * account-wide invalidation sweep. Account deletion cascades — tokens
 * never outlive the identity they act on.
 *
 * @module D1EmailTokenRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { openMigratedD1 } from './d1-test-harness';
import { D1EmailTokenRepository } from '../email-token.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1EmailTokenRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 300;
async function seedAccount(): Promise<number> {
  const id = ++accountIdSeq;
  db.prepare(
    `INSERT INTO accounts (id, user_id, email) VALUES (?, ?, ?)`,
  ).run(id, `user-${id}@test.invalid`, `user-${id}@test.invalid`);
  return id;
}

/** 64-hex token hash, exactly what the token service stores. */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function aToken(): string {
  return randomBytes(32).toString('base64url');
}

const HOUR_MS = 3_600_000;

function futureExpiry(hoursFromNow = 24): Date {
  return new Date(Date.now() + hoursFromNow * HOUR_MS);
}

async function createToken(
  accountId: number,
  purpose: 'verify_email' | 'password_reset',
  expiresAt?: Date,
) {
  const token = aToken();
  return { token, row: await repo.create({ accountId, tokenHash: hash(token), purpose, expiresAt: expiresAt ?? futureExpiry() }) };
}

describe('D1EmailTokenRepository.create', () => {
  it('stores the hash unconsumed with the caller-set expiry — no raw token reaches this layer', async () => {
    const accountId = await seedAccount();
    const { token, row } = await createToken(accountId, 'verify_email');

    expect(row.id).toBeGreaterThan(0);
    expect(row.accountId).toBe(accountId);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.purpose).toBe('verify_email');
    expect(row.usedAt).toBeNull();
    // Expiry is caller policy — stored verbatim, not owned here.
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.createdAt).toBeInstanceOf(Date);

    const stored = db.prepare('SELECT token_hash FROM email_tokens').all() as {
      token_hash: string;
    }[];
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('rejects a purpose outside the closed CHECK set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO email_tokens (account_id, token_hash, purpose, expires_at)
           VALUES ((SELECT max(id) FROM accounts), '${hash('x')}', 'login_bypass', '2027-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('cascades on account deletion — tokens never outlive the identity', async () => {
    const accountId = await seedAccount();
    await createToken(accountId, 'password_reset');
    expect(
      (db.prepare('SELECT count(*) AS n FROM email_tokens WHERE account_id = ?').get(accountId) as { n: number }).n,
    ).toBe(1);

    db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    expect(
      (db.prepare('SELECT count(*) AS n FROM email_tokens WHERE account_id = ?').get(accountId) as { n: number }).n,
    ).toBe(0);
  });
});

describe('D1EmailTokenRepository.findActiveByTokenHashAndPurpose', () => {
  it('finds the unconsumed, unexpired token for the (hash, purpose) pair', async () => {
    const accountId = await seedAccount();
    const { token } = await createToken(accountId, 'verify_email');

    const active = await repo.findActiveByTokenHashAndPurpose(hash(token), 'verify_email');
    expect(active).not.toBeNull();
    expect(active!.accountId).toBe(accountId);
    expect(active!.usedAt).toBeNull();
  });

  it('denies consumed, expired, unknown, and cross-purpose presentations identically', async () => {
    const accountId = await seedAccount();

    const consumed = await createToken(accountId, 'verify_email');
    expect(await repo.consume(hash(consumed.token), 'verify_email')).toBe(true);
    await expect(
      repo.findActiveByTokenHashAndPurpose(hash(consumed.token), 'verify_email'),
    ).resolves.toBeNull();

    const expired = await createToken(accountId, 'verify_email', new Date(Date.now() - 1_000));
    await expect(
      repo.findActiveByTokenHashAndPurpose(hash(expired.token), 'verify_email'),
    ).resolves.toBeNull();

    await expect(
      repo.findActiveByTokenHashAndPurpose(hash(aToken()), 'verify_email'),
    ).resolves.toBeNull();

    // Cross-purpose confusion: the reset token does not verify the email.
    const reset = await createToken(accountId, 'password_reset');
    await expect(
      repo.findActiveByTokenHashAndPurpose(hash(reset.token), 'verify_email'),
    ).resolves.toBeNull();
  });
});

describe('D1EmailTokenRepository.consume', () => {
  it('redeems exactly once — the replay and the second winner both lose', async () => {
    const accountId = await seedAccount();
    const { token } = await createToken(accountId, 'verify_email');

    await expect(repo.consume(hash(token), 'verify_email')).resolves.toBe(true);
    // The row still exists — it is stamped, not deleted (audit visibility).
    const stamped = db
      .prepare('SELECT used_at FROM email_tokens WHERE token_hash = ?')
      .get(hash(token)) as { used_at: string };
    expect(stamped.used_at).not.toBeNull();

    await expect(repo.consume(hash(token), 'verify_email')).resolves.toBe(false);
  });

  it('rejects expired and wrong-purpose tokens — never a silent redemption', async () => {
    const accountId = await seedAccount();

    const expired = await createToken(accountId, 'password_reset', new Date(Date.now() - 1_000));
    await expect(repo.consume(hash(expired.token), 'password_reset')).resolves.toBe(false);

    const verify = await createToken(accountId, 'verify_email');
    await expect(repo.consume(hash(verify.token), 'password_reset')).resolves.toBe(false);
    // Still redeemable for its own purpose after the denied attempt.
    await expect(repo.consume(hash(verify.token), 'verify_email')).resolves.toBe(true);
  });

  it('ignores expiry only at the exclusive edge — a token is dead the instant it expires', async () => {
    const accountId = await seedAccount();
    const edge = await createToken(accountId, 'verify_email', new Date(Date.now() + 50));
    await new Promise((r) => setTimeout(r, 60));
    await expect(repo.consume(hash(edge.token), 'verify_email')).resolves.toBe(false);
  });
});

describe('D1EmailTokenRepository.invalidateAllForAccount', () => {
  it('retires every outstanding same-purpose token, touching consumed rows and other purposes', async () => {
    const accountId = await seedAccount();

    const a = await createToken(accountId, 'verify_email');
    const b = await createToken(accountId, 'verify_email');
    const alreadyUsed = await createToken(accountId, 'verify_email');
    await repo.consume(hash(alreadyUsed.token), 'verify_email');
    const reset = await createToken(accountId, 'password_reset');

    const retired = await repo.invalidateAllForAccount(accountId, 'verify_email');
    expect(retired).toBe(2);

    // Outstanding tokens are stamped used.
    for (const { token } of [a, b]) {
      const row = db
        .prepare('SELECT used_at FROM email_tokens WHERE token_hash = ?')
        .get(hash(token)) as { used_at: string | null };
      expect(row.used_at).not.toBeNull();
    }
    // Already-consumed rows keep their original stamp (idempotent no-op)…
    const used = db
      .prepare('SELECT used_at FROM email_tokens WHERE token_hash = ?')
      .get(hash(alreadyUsed.token)) as { used_at: string | null };
    expect(used.used_at).not.toBeNull();
    // …and the other purpose is untouched.
    const resetRow = db
      .prepare('SELECT used_at FROM email_tokens WHERE token_hash = ?')
      .get(hash(reset.token)) as { used_at: string | null };
    expect(resetRow.used_at).toBeNull();
  });

  it('returns 0 for an account with no outstanding tokens', async () => {
    const accountId = await seedAccount();
    await expect(repo.invalidateAllForAccount(accountId, 'password_reset')).resolves.toBe(0);
  });

  it('scopes to the account — tokens of other accounts stay redeemable', async () => {
    const accountA = await seedAccount();
    const accountB = await seedAccount();
    const tokenA = await createToken(accountA, 'verify_email');
    const tokenB = await createToken(accountB, 'verify_email');

    await repo.invalidateAllForAccount(accountA, 'verify_email');

    await expect(repo.consume(hash(tokenA.token), 'verify_email')).resolves.toBe(false);
    await expect(repo.consume(hash(tokenB.token), 'verify_email')).resolves.toBe(true);
  });
});

/**
 * D1SessionRepository — real-SQLite tests (task 2.5) on the node:sqlite
 * harness with the committed migrations applied. Ports the security
 * expectations of the pg repository tests and the application-api
 * session-security semantics down to the storage boundary: hash-only at
 * rest, active = unrevoked AND unexpired, rotation is atomic (never both
 * valid, never neither), a rotated token never mints a successor, and
 * two concurrent rotations produce exactly one successor.
 *
 * @module D1SessionRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { openMigratedD1 } from './d1-test-harness';
import { D1SessionRepository } from '../session.repository';

const { db, d1 } = openMigratedD1();
const repo = new D1SessionRepository(d1);

/** Fresh DB per test would be cleaner; ids stay unique per test instead. */
let accountIdSeq = 100;
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

const DEFAULT_EXPIRY = () => new Date(Date.now() + 30 * 86_400_000);

async function createSession(accountId: number, tokenHash: string, expiresAt?: Date) {
  return repo.create({
    tokenHash,
    accountId,
    expiresAt: expiresAt ?? DEFAULT_EXPIRY(),
  });
}

describe('D1SessionRepository', () => {
  it('stores the hash with account and expiry — no raw token ever reaches this layer', async () => {
    const accountId = await seedAccount();
    const token = aToken();
    const row = await createSession(accountId, hash(token));

    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.accountId).toBe(accountId);
    expect(row.revokedAt).toBeNull();
    expect(row.rotatedFromId).toBeNull();
    // The serialized rows never contain the raw token value.
    const stored = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('authenticates the active session for the token hash and derives identity from the row', async () => {
    const accountId = await seedAccount();
    const token = aToken();
    await createSession(accountId, hash(token));

    const active = await repo.findActiveByTokenHash(hash(token));
    expect(active).not.toBeNull();
    // Account identity comes from the row, never from a caller claim.
    expect(active!.accountId).toBe(accountId);
  });

  it('denies forged and guessed tokens — unknown hashes authenticate nothing', async () => {
    const accountId = await seedAccount();
    await createSession(accountId, hash(aToken()));

    for (let i = 0; i < 3; i++) {
      await expect(repo.findActiveByTokenHash(hash(aToken()))).resolves.toBeNull();
    }
    // A tampered/truncated variant of a real token hashes to an unknown
    // digest and is denied the same way — indistinguishable rejections.
    const real = hash('real-token-value');
    await createSession(accountId, real);
    await expect(repo.findActiveByTokenHash(hash('real-token-valuX'))).resolves.toBeNull();
    await expect(repo.findActiveByTokenHash(hash('real-token-valu'))).resolves.toBeNull();
    // Presenting the stored digest itself as a token re-hashes it — denied.
    await expect(repo.findActiveByTokenHash(hash(real))).resolves.toBeNull();
  });

  it('denies expired and revoked sessions — only unrevoked+unexpired authenticates', async () => {
    const accountId = await seedAccount();

    const expiredToken = aToken();
    await createSession(accountId, hash(expiredToken), new Date(Date.now() - 1_000));
    await expect(repo.findActiveByTokenHash(hash(expiredToken))).resolves.toBeNull();

    const revokedToken = aToken();
    await createSession(accountId, hash(revokedToken));
    await expect(repo.revokeByTokenHash(hash(revokedToken))).resolves.toBe(true);
    await expect(repo.findActiveByTokenHash(hash(revokedToken))).resolves.toBeNull();
    // Revoking again reports false — nothing active left to revoke.
    await expect(repo.revokeByTokenHash(hash(revokedToken))).resolves.toBe(false);
  });

  describe('rotate', () => {
    it('the old token dies immediately, the successor authenticates the same account', async () => {
      const accountId = await seedAccount();
      const oldToken = aToken();
      await createSession(accountId, hash(oldToken));

      const successor = await repo.rotate(
        hash(oldToken),
        hash(aToken()),
        DEFAULT_EXPIRY(),
      );
      expect(successor).not.toBeNull();

      await expect(repo.findActiveByTokenHash(hash(oldToken))).resolves.toBeNull();
      const viaNew = await repo.findActiveByTokenHash(successor!.tokenHash);
      expect(viaNew).not.toBeNull();
      expect(viaNew!.accountId).toBe(accountId);
    });

    it('links the successor to the revoked predecessor (audit chain)', async () => {
      const accountId = await seedAccount();
      const oldToken = aToken();
      const predecessor = await createSession(accountId, hash(oldToken));

      const successor = await repo.rotate(
        hash(oldToken),
        hash(aToken()),
        DEFAULT_EXPIRY(),
      );
      expect(successor!.rotatedFromId).toBe(predecessor.id);
      expect(successor!.revokedAt).toBeNull();

      const predecessorAfter = db
        .prepare('SELECT revoked_at FROM sessions WHERE id = ?')
        .get(predecessor.id) as { revoked_at: string | null };
      expect(predecessorAfter.revoked_at).not.toBeNull();
    });

    it('a rotated token never mints a successor — and neither does a guess', async () => {
      const accountId = await seedAccount();
      const oldToken = aToken();
      await createSession(accountId, hash(oldToken));

      const first = await repo.rotate(hash(oldToken), hash(aToken()), DEFAULT_EXPIRY());
      expect(first).not.toBeNull();

      await expect(
        repo.rotate(hash(oldToken), hash(aToken()), DEFAULT_EXPIRY()),
      ).resolves.toBeNull();
      await expect(
        repo.rotate(hash(aToken()), hash(aToken()), DEFAULT_EXPIRY()),
      ).resolves.toBeNull();
    });

    it('two concurrent rotations of one token produce exactly one successor', async () => {
      const accountId = await seedAccount();
      const token = aToken();
      await createSession(accountId, hash(token));

      const results = await Promise.all([
        repo.rotate(hash(token), hash(`successor-a:${aToken()}`), DEFAULT_EXPIRY()),
        repo.rotate(hash(token), hash(`successor-b:${aToken()}`), DEFAULT_EXPIRY()),
      ]);
      const successors = results.filter((r) => r !== null);
      expect(successors).toHaveLength(1);

      // Exactly one live credential for THIS account afterwards: the
      // winner's hash works, the loser never existed, the original is dead.
      const live = db
        .prepare('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL AND account_id = ?')
        .get(accountId) as { n: number };
      expect(live.n).toBe(1);
      await expect(repo.findActiveByTokenHash(hash(token))).resolves.toBeNull();
    });
  });

  it('deleteExpiredBefore removes only expired sessions and returns the count', async () => {
    const accountId = await seedAccount();
    await createSession(accountId, hash(aToken()), new Date('2026-08-01T00:00:00.000Z'));
    await createSession(accountId, hash(aToken()), new Date('2026-08-02T00:00:00.000Z'));
    const keepToken = aToken();
    await createSession(accountId, hash(keepToken), new Date('2026-09-30T00:00:00.000Z'));

    const deleted = await repo.deleteExpiredBefore(new Date('2026-08-15T00:00:00.000Z'));
    expect(deleted).toBe(2);

    await expect(repo.findActiveByTokenHash(hash(keepToken))).resolves.not.toBeNull();
  });
});

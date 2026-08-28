import { describe, it, expect } from 'vitest';
import type {
  AccountRepository,
  SessionRepository,
  SessionRecord,
  sessions,
} from '@rajahinta/data-platform';
import { SessionTokenService } from '../session-token.service';

// ---------------------------------------------------------------------------
// Fakes — an in-memory SessionRepository honouring the abstract contract
// (active = unrevoked + unexpired; rotate is atomic), and an account
// lookup table. These test the token MINT/HASH/RESOLVE semantics; the
// Drizzle SQL is covered by the data-platform repository suite.
// ---------------------------------------------------------------------------

interface AccountRow {
  id: number;
  userId: string;
  email: string;
  tier: string;
  createdAt: Date;
  lastActiveAt: Date;
}

function makeAccount(id: number): AccountRow {
  const now = new Date();
  return {
    id,
    userId: `user-${id}`,
    email: `user-${id}@example.invalid`,
    tier: 'FREE',
    createdAt: now,
    lastActiveAt: now,
  };
}

class FakeSessionRepository implements SessionRepository {
  rows: SessionRecord[] = [];
  private nextId = 1;

  async create(record: typeof sessions.$inferInsert) {
    const row: SessionRecord = {
      id: this.nextId++,
      tokenHash: record.tokenHash,
      accountId: record.accountId,
      rotatedFromId: record.rotatedFromId ?? null,
      createdAt: new Date(),
      expiresAt: record.expiresAt instanceof Date ? record.expiresAt : new Date(Date.now() + 3_600_000),
      revokedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveByTokenHash(tokenHash: string) {
    const now = new Date();
    return (
      this.rows.find(
        (r) =>
          r.tokenHash === tokenHash &&
          r.revokedAt === null &&
          r.expiresAt > now,
      ) ?? null
    );
  }

  async rotate(tokenHash: string, newTokenHash: string, expiresAt: Date) {
    const current = await this.findActiveByTokenHash(tokenHash);
    if (!current) return null;
    const successor = await this.create({
      tokenHash: newTokenHash,
      accountId: current.accountId,
      rotatedFromId: current.id,
      expiresAt,
    });
    current.revokedAt = new Date();
    return successor;
  }

  async revokeByTokenHash(tokenHash: string) {
    const current = await this.findActiveByTokenHash(tokenHash);
    if (!current) return false;
    current.revokedAt = new Date();
    return true;
  }

  async deleteExpiredBefore(cutoff: Date) {
    const doomed = this.rows.filter((r) => r.expiresAt < cutoff);
    this.rows = this.rows.filter((r) => r.expiresAt >= cutoff);
    return doomed.length;
  }
}

class FakeAccountRepository implements AccountRepository {
  constructor(readonly rows: AccountRow[]) {}

  async create(): Promise<never> {
    throw new Error('not used in this suite');
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByUserId() {
    return null;
  }
  async updateLastActive() {}
  async delete() {}
  async findAllUserIds() {
    return [];
  }
  async anonymize() {}
}

function makeService() {
  const sessions = new FakeSessionRepository();
  const accounts = new FakeAccountRepository([makeAccount(7), makeAccount(9)]);
  const service = new SessionTokenService(sessions, accounts);
  return { service, sessions, accounts };
}

describe('SessionTokenService', () => {
  it('issues an opaque token whose hash-only form is persisted', async () => {
    const { service, sessions } = makeService();
    const issued = await service.issueSession(7);

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issued.token).not.toContain('@');
    // Only the SHA-256 digest reaches storage — never the token itself.
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0].tokenHash).toBe(
      SessionTokenService.hashToken(issued.token),
    );
    expect(sessions.rows[0].tokenHash).toHaveLength(64);
    expect(sessions.rows[0].accountId).toBe(7);
  });

  it('derives the account exclusively from a valid presented token', async () => {
    const { service } = makeService();
    const issued = await service.issueSession(7);

    const account = await service.resolveAccountByToken(issued.token);
    expect(account?.id).toBe(7);

    // Same token, one character mutated — hash lookup misses, denied.
    const forged = issued.token.slice(0, -1) + 'X';
    await expect(service.resolveAccountByToken(forged)).resolves.toBeNull();
  });

  it('denies guessed and empty tokens', async () => {
    const { service } = makeService();
    await service.issueSession(7);

    await expect(service.resolveAccountByToken('')).resolves.toBeNull();
    await expect(
      service.resolveAccountByToken('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    ).resolves.toBeNull();
  });

  it('rotation invalidates the old token and authenticates the successor', async () => {
    const { service } = makeService();
    const first = await service.issueSession(7);

    const second = await service.rotateSessionToken(first.token);
    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first.token);
    expect(second!.session.accountId).toBe(7);
    expect(second!.session.rotatedFromId).toBe(first.session.id);

    // Old token is dead; new token resolves the same account.
    await expect(service.resolveAccountByToken(first.token)).resolves.toBeNull();
    const account = await service.resolveAccountByToken(second!.token);
    expect(account?.id).toBe(7);
  });

  it('a rotated (already-invalid) token cannot mint another session', async () => {
    const { service } = makeService();
    const first = await service.issueSession(7);
    const second = await service.rotateSessionToken(first.token);

    // Replaying the same old token must not rotate again.
    await expect(service.rotateSessionToken(first.token)).resolves.toBeNull();
    expect(second).not.toBeNull();
  });

  it('revoke kills the session', async () => {
    const { service } = makeService();
    const issued = await service.issueSession(9);

    await expect(service.revokeSession(issued.token)).resolves.toBe(true);
    await expect(service.resolveAccountByToken(issued.token)).resolves.toBeNull();
    await expect(service.revokeSession(issued.token)).resolves.toBe(false);
  });

  it('tokens are unique across issuances', async () => {
    const { service } = makeService();
    const a = await service.issueSession(7);
    const b = await service.issueSession(7);
    expect(a.token).not.toBe(b.token);
  });
});

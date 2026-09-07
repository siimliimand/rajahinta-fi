/**
 * SessionAuthGuard tests (task 2.2, change technical-assessment-remediation;
 * spec session-authentication).
 *
 * Guard-level scenarios with REAL SessionTokenService over in-memory fakes:
 * token derives identity, legacy x-user-id header rejected outright (with
 * or without a token), missing/guessed/expired tokens denied.
 *
 * @module SessionAuthGuardTest
 */

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type {
  AccountCredentialRecord,
  AccountRepository,
  SessionRepository,
  SessionRecord,
  sessions,
} from '@rajahinta/data-platform';
import { SessionTokenService } from '../session-token.service';
import { SessionAuthGuard } from '../session-auth.guard';
import { SESSION_COOKIE_NAME } from '../session-cookie';

// ---------------------------------------------------------------------------
// Fakes (same shapes as session-token.service.test.ts)
// ---------------------------------------------------------------------------

interface AccountRow {
  id: number;
  userId: string;
  email: string;
  tier: string;
  createdAt: Date;
  lastActiveAt: Date;
}

function makeAccount(id: number, email: string): AccountRow {
  const now = new Date();
  return { id, userId: `user-${id}`, email, tier: 'FREE', createdAt: now, lastActiveAt: now };
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
        (r) => r.tokenHash === tokenHash && r.revokedAt === null && r.expiresAt > now,
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
  // DrizzleAccountRepository parity: credential columns are null on the
  // legacy pg harness (design D9, change email-password-auth).
  async findByEmail(email: string): Promise<AccountCredentialRecord | null> {
    const row = this.rows.find(
      (r) => r.email.toLowerCase() === email.toLowerCase(),
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      email: row.email,
      passwordHash: null,
      emailVerifiedAt: null,
      tier: row.tier,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
    };
  }
  async updateLastActive() {}
  // Credential writes have no harness columns — reject loudly, mirroring
  // the pg repository (design D9).
  async setVerifiedEmail(_userId: string, _verifiedAt: Date): Promise<void> {
    throw new Error(
      'setVerifiedEmail is not supported by the harness (design D9)',
    );
  }
  async setPasswordHash(_userId: string, _passwordHash: string): Promise<void> {
    throw new Error(
      'setPasswordHash is not supported by the harness (design D9)',
    );
  }
  async delete() {}
  async findAllUserIds() {
    return [];
  }
  async anonymize() {}
}

function makeGuard() {
  const sessionRepo = new FakeSessionRepository();
  const accountRepo = new FakeAccountRepository([
    makeAccount(7, 'user-7@example.invalid'),
    makeAccount(9, 'user-9@example.invalid'),
  ]);
  const service = new SessionTokenService(sessionRepo, accountRepo);
  const guard = new SessionAuthGuard(service);
  return { guard, service, sessionRepo, accountRepo };
}

/** ExecutionContext over a raw request object. */
function context(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: () => undefined }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

const cookieHeader = (token: string): Record<string, unknown> => ({
  headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
});

// ---------------------------------------------------------------------------

describe('SessionAuthGuard', () => {
  it('derives the account from a valid token and attaches the identity', async () => {
    const { guard, service } = makeGuard();
    const issued = await service.issueSession(7);
    const request: Record<string, unknown> = cookieHeader(issued.token);

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({
      accountId: 7,
      userId: 'user-7',
      tier: 'FREE',
    });
    // The raw token stays available for rotate/revoke handlers.
    expect(request.sessionToken).toBe(issued.token);
  });

  it('attaches no email-verification state (credentials live only in the API Worker)', async () => {
    const { guard, service } = makeGuard();
    const issued = await service.issueSession(7);

    const request = cookieHeader(issued.token);
    await guard.canActivate(context(request));

    // The placeholder-era derived `verified` flag was removed (task 4.1,
    // design D9) — the guard identity carries only id/userId/tier.
    expect(request.user).toMatchObject({
      accountId: 7,
      userId: 'user-7',
      tier: 'FREE',
    });
    expect(request.user).not.toHaveProperty('verified');
  });

  it('reads the token from a parsed cookie jar as well', async () => {
    const { guard, service } = makeGuard();
    const issued = await service.issueSession(7);
    const request = {
      cookies: { [SESSION_COOKIE_NAME]: issued.token },
      headers: {},
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
  });

  describe('legacy x-user-id header — rejected outright', () => {
    it('rejects a request presenting the header, even alongside a valid token', async () => {
      const { guard, service } = makeGuard();
      const issued = await service.issueSession(7);
      const request = {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${issued.token}`,
          'x-user-id': 'attacker-chosen-id',
        },
      };

      await expect(guard.canActivate(context(request))).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof UnauthorizedException &&
          (err.getResponse() as Record<string, unknown>).error ===
            'LegacyUserIdHeaderRejected',
      );
    });

    it('rejects the header on its own (no token presented)', async () => {
      const { guard } = makeGuard();
      await expect(
        guard.canActivate(context({ headers: { 'x-user-id': 'someone' } })),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('an empty header value is treated as absent', async () => {
      const { guard, service } = makeGuard();
      const issued = await service.issueSession(7);
      const request = {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${issued.token}`,
          'x-user-id': '   ',
        },
      };
      await expect(guard.canActivate(context(request))).resolves.toBe(true);
    });
  });

  it('denies a request without a session cookie (401 SessionRequired)', async () => {
    const { guard } = makeGuard();
    await expect(
      guard.canActivate(context({ headers: {} })),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UnauthorizedException &&
        (err.getResponse() as Record<string, unknown>).error === 'SessionRequired',
    );
  });

  it('denies a guessed/unknown token (401 InvalidSession)', async () => {
    const { guard } = makeGuard();
    await expect(
      guard.canActivate(context(cookieHeader('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'))),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UnauthorizedException &&
        (err.getResponse() as Record<string, unknown>).error === 'InvalidSession',
    );
  });

  it('denies a revoked token (logout kills the session)', async () => {
    const { guard, service } = makeGuard();
    const issued = await service.issueSession(7);
    await service.revokeSession(issued.token);

    await expect(
      guard.canActivate(context(cookieHeader(issued.token))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('denies an expired token', async () => {
    const { guard, service, sessionRepo } = makeGuard();
    const issued = await service.issueSession(7);
    sessionRepo.rows[0].expiresAt = new Date(Date.now() - 1_000);

    await expect(
      guard.canActivate(context(cookieHeader(issued.token))),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('denies a rotated-away token (successor replaces it)', async () => {
    const { guard, service } = makeGuard();
    const first = await service.issueSession(7);
    const second = await service.rotateSessionToken(first.token);

    await expect(
      guard.canActivate(context(cookieHeader(first.token))),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(context(cookieHeader(second!.token))),
    ).resolves.toBe(true);
  });
});

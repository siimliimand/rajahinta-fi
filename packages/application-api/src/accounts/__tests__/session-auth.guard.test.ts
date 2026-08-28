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
  async updateLastActive() {}
  async delete() {}
  async findAllUserIds() {
    return [];
  }
  async anonymize() {}
}

function makeGuard() {
  const sessionRepo = new FakeSessionRepository();
  const accountRepo = new FakeAccountRepository([
    makeAccount(7, 'user-7@example.invalid'), // verified email
    makeAccount(9, 'user-9@placeholder.local'), // anonymous placeholder
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

  it('marks verified state from the account email (placeholder ⇒ anonymous)', async () => {
    const { guard, service } = makeGuard();
    const verified = await service.issueSession(7);
    const anonymous = await service.issueSession(9);

    const verifiedReq = cookieHeader(verified.token);
    await guard.canActivate(context(verifiedReq));
    expect((verifiedReq.user as { verified: boolean }).verified).toBe(true);

    const anonReq = cookieHeader(anonymous.token);
    await guard.canActivate(context(anonReq));
    expect((anonReq.user as { verified: boolean }).verified).toBe(false);
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

/**
 * SessionController tests (task 2.2, change technical-assessment-remediation;
 * trimmed by task 4.1, change email-password-auth).
 *
 * Rotate/revoke against a REAL SessionTokenService over in-memory fakes —
 * verifies rotation replaces the cookie (and the old token stops
 * authenticating immediately) and logout clears it. Sessions are
 * established through SessionTokenService.issueSession: the harness has
 * no issuance endpoint (credentials auth lives only in the API Worker,
 * design D9).
 *
 * @module SessionControllerTest
 */

import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AccountCredentialRecord,
  AccountRepository,
  SessionRepository,
  SessionRecord,
  sessions,
  accounts,
} from '@rajahinta/data-platform';
import { SessionTokenService } from '../session-token.service';
import { SessionController } from '../session.controller';
import { SessionAuthGuard } from '../session-auth.guard';
import type { AuthenticatedAccount } from '../current-user.decorator';
import { SESSION_COOKIE_NAME } from '../session-cookie';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class InMemoryAccountRows implements AccountRepository {
  private nextId = 1;
  readonly rows: (typeof accounts.$inferSelect)[] = [];

  async create(record: typeof accounts.$inferInsert) {
    const row = {
      id: this.nextId++,
      userId: record.userId,
      email: record.email,
      tier: record.tier ?? 'FREE',
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByUserId(userId: string) {
    return this.rows.find((r) => r.userId === userId) ?? null;
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
    return this.rows.map((r) => r.userId);
  }
  async anonymize() {}
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

function makeController() {
  const sessionRepo = new FakeSessionRepository();
  const accountRepo = new InMemoryAccountRows();
  const tokenService = new SessionTokenService(sessionRepo, accountRepo);
  const controller = new SessionController(tokenService);
  const guard = new SessionAuthGuard(tokenService);
  return { controller, tokenService, sessionRepo, accountRepo, guard };
}

/** Create an account row and mint a real session for it. */
async function establishSession(
  tokenService: SessionTokenService,
  accountRepo: InMemoryAccountRows,
) {
  const row = await accountRepo.create({
    userId: randomUUID(),
    email: `${randomUUID()}@example.invalid`,
    tier: 'FREE',
  });
  const issued = await tokenService.issueSession(row.id);
  return { token: issued.token, userId: row.userId, accountId: row.id };
}

/** Response double capturing Set-Cookie headers. */
function responseDouble(): { headers: Record<string, string>; header(name: string, value: string): void } {
  const headers: Record<string, string> = {};
  return {
    headers,
    header(name, value) {
      headers[name] = value;
    },
  };
}

// ---------------------------------------------------------------------------

describe('SessionController', () => {
  describe('POST /api/v1/account/session/rotate — rotate', () => {
    it('replaces the cookie and the old token stops authenticating', async () => {
      const { controller, tokenService, guard, accountRepo } = makeController();

      // Establish a session the harness way: account row + issued token.
      const established = await establishSession(tokenService, accountRepo);
      const token = established.token;

      // Attach the guard-derived identity the way a real request would.
      const request: {
        headers: { cookie: string };
        user?: AuthenticatedAccount;
      } = {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      };
      await guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ header: () => undefined }) }),
      } as never);
      const user = request.user!;

      const rotateRes = responseDouble();
      const body = await controller.rotate(
        user,
        { sessionToken: token },
        rotateRes,
      );

      expect(body.userId).toBe(established.userId);
      const newCookie = rotateRes.headers['Set-Cookie'];
      expect(newCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      const newToken = newCookie!.slice(
        `${SESSION_COOKIE_NAME}=`.length,
        newCookie!.indexOf(';'),
      );
      expect(newToken).not.toBe(token);

      // Old token dead, new token resolves the same account.
      await expect(tokenService.resolveAccountByToken(token)).resolves.toBeNull();
      const account = await tokenService.resolveAccountByToken(newToken);
      expect(account?.userId).toBe(established.userId);
    });

    it('throws UnauthorizedException when the presented token has no active session (race)', async () => {
      const { controller } = makeController();
      await expect(
        controller.rotate(
          { accountId: 1, userId: 'u', tier: 'FREE' },
          { sessionToken: '' },
          responseDouble(),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('DELETE /api/v1/account/session — revoke', () => {
    it('revokes the session and clears the cookie', async () => {
      const { controller, tokenService, accountRepo } = makeController();
      const established = await establishSession(tokenService, accountRepo);
      const token = established.token;

      const revokeRes = responseDouble();
      await expect(
        controller.revoke({ sessionToken: token }, revokeRes),
      ).resolves.toEqual({ revoked: true });

      expect(revokeRes.headers['Set-Cookie']).toContain('Max-Age=0');
      await expect(tokenService.resolveAccountByToken(token)).resolves.toBeNull();
    });
  });
});

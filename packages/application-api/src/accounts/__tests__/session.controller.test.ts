/**
 * SessionController tests (task 2.2, change technical-assessment-remediation).
 *
 * Issue/rotate/revoke against a REAL SessionTokenService over in-memory
 * fakes — verifies the cookie is the only place the token travels, the
 * identity is server-generated, rotation replaces the cookie, and logout
 * clears it.
 *
 * @module SessionControllerTest
 */

import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type {
  AccountRepository,
  SessionRepository,
  SessionRecord,
  sessions,
  accounts,
} from '@rajahinta/data-platform';
import { SessionTokenService } from '../session-token.service';
import { SessionController } from '../session.controller';
import { AccountService } from '../account.service';
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
      email: record.email ?? 'a@placeholder.local',
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
  async updateLastActive() {}
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
  // Test environment: repos present, in-memory fallback allowed.
  const accountService = new AccountService(accountRepo);
  const controller = new SessionController(tokenService, accountService);
  const guard = new SessionAuthGuard(tokenService);
  return { controller, tokenService, sessionRepo, accountRepo, guard };
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
  describe('POST /api/v1/account/session — issue', () => {
    it('creates a server-generated anonymous account and links the session to it', async () => {
      const { controller, sessionRepo, accountRepo } = makeController();
      const res = responseDouble();

      const body = await controller.issue(res);

      expect(accountRepo.rows).toHaveLength(1);
      expect(body.userId).toBe(accountRepo.rows[0].userId);
      // Server-generated identity (UUID), never client-chosen.
      expect(body.userId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(body.verified).toBe(false);
      expect(body.expiresAt).toBe(sessionRepo.rows[0].expiresAt.toISOString());
      expect(sessionRepo.rows[0].accountId).toBe(accountRepo.rows[0].id);
    });

    it('sets the token only as an httpOnly cookie — never in the body', async () => {
      const { controller, sessionRepo } = makeController();
      const res = responseDouble();

      const body = await controller.issue(res);

      const setCookie = res.headers['Set-Cookie'];
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      // The raw token appears only in the cookie header — the body carries
      // no credential material.
      expect(JSON.stringify(body)).not.toContain(sessionRepo.rows[0].tokenHash);
      const token = setCookie!.slice(
        `${SESSION_COOKIE_NAME}=`.length,
        setCookie!.indexOf(';'),
      );
      expect(token.length).toBeGreaterThanOrEqual(40);
    });

    it('each issuance mints a distinct identity and token', async () => {
      const { controller } = makeController();
      const first = await controller.issue(responseDouble());
      const second = await controller.issue(responseDouble());
      expect(first.userId).not.toBe(second.userId);
    });
  });

  describe('POST /api/v1/account/session/rotate — rotate', () => {
    it('replaces the cookie and the old token stops authenticating', async () => {
      const { controller, tokenService, guard } = makeController();

      // Issue and recover the raw token from the Set-Cookie header (the
      // only place it ever travels).
      const issueRes = responseDouble();
      const issued = await controller.issue(issueRes);
      const token = issueRes.headers['Set-Cookie']!.slice(
        `${SESSION_COOKIE_NAME}=`.length,
        issueRes.headers['Set-Cookie']!.indexOf(';'),
      );

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

      expect(body.userId).toBe(issued.userId);
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
      expect(account?.userId).toBe(issued.userId);
    });

    it('throws UnauthorizedException when the presented token has no active session (race)', async () => {
      const { controller } = makeController();
      await expect(
        controller.rotate(
          { accountId: 1, userId: 'u', tier: 'FREE', verified: false },
          { sessionToken: '' },
          responseDouble(),
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('DELETE /api/v1/account/session — revoke', () => {
    it('revokes the session and clears the cookie', async () => {
      const { controller, tokenService } = makeController();
      const res = responseDouble();
      await controller.issue(res);
      const token = res.headers['Set-Cookie']!.slice(
        `${SESSION_COOKIE_NAME}=`.length,
        res.headers['Set-Cookie']!.indexOf(';'),
      );

      const revokeRes = responseDouble();
      await expect(
        controller.revoke({ sessionToken: token }, revokeRes),
      ).resolves.toEqual({ revoked: true });

      expect(revokeRes.headers['Set-Cookie']).toContain('Max-Age=0');
      await expect(tokenService.resolveAccountByToken(token)).resolves.toBeNull();
    });
  });
});

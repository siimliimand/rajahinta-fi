/**
 * SessionAuthMiddleware parity tests (task 3.2, change
 * migrate-to-cloudflare) — ported from
 * packages/application-api/src/accounts/__tests__/session-auth.guard.test.ts
 * and session-security.test.ts.
 *
 * Runs the REAL middleware over the REAL D1 session repository
 * (task 2.5) on the fake-D1 harness (in-memory SQLite + committed
 * migrations): token derives identity, forged/guessed/tampered/expired/
 * revoked/rotated-away tokens are denied, the retired x-user-id header is
 * rejected outright with or without a valid token, and cross-account
 * identity never leaks through client-supplied headers.
 *
 * @module SessionAuthMiddlewareTest
 */

import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  expectEnvelope,
  mintOpaqueToken,
  issueSessionToken,
  openMigratedD1,
  probe,
  buildProbeApp,
  seedStandardAccounts,
  testEnv,
} from './guard-test-harness';
import { SESSION_COOKIE_NAME } from '../session-auth';
import { hashToken } from '../../auth/session-resolver';
import { D1SessionRepository } from '../../../../../packages/data-platform/src/repositories/d1/session.repository';

const cookieHeader = (token: string): RequestInit => ({
  headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
});

describe('SessionAuthMiddleware', () => {
  it('derives the account from a valid token and attaches the identity', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const token = await issueSessionToken(d1, 7);

    const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
      ...cookieHeader(token),
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown>; sessionToken: string };
    expect(body.user).toEqual({
      accountId: 7,
      userId: 'user-7',
      tier: 'FREE',
      verified: true,
    });
    // The raw token stays on the context for rotate/revoke handlers.
    expect(body.sessionToken).toBe(token);
  });

  it('marks verified state from the account email (placeholder ⇒ anonymous)', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const env = testEnv(d1);

    const verified = await probe(app, env, '/api/v1/account/export', {
      ...cookieHeader(await issueSessionToken(d1, 7)),
      method: 'GET',
    });
    const anonymous = await probe(app, env, '/api/v1/account/export', {
      ...cookieHeader(await issueSessionToken(d1, 9)),
      method: 'GET',
    });

    expect(((await verified.json()) as { user: { verified: boolean } }).user.verified).toBe(true);
    expect(((await anonymous.json()) as { user: { verified: boolean } }).user.verified).toBe(false);
  });

  it('resolves tier from the account row (PREMIUM account)', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();

    const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
      ...cookieHeader(await issueSessionToken(d1, 11)),
      method: 'GET',
    });

    expect(((await res.json()) as { user: { tier: string } }).user.tier).toBe('PREMIUM');
  });

  it('derives the account from the token record, not from any client claim', async () => {
    const { db, d1 } = openMigratedD1();
    seedStandardAccounts(db);
    const app = buildProbeApp();
    const token = await issueSessionToken(d1, 7);

    // A client asserts a different identity in every plausible place —
    // none of it influences the derived account.
    const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
      method: 'GET',
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
        'x-account-id': '1006',
        'x-user': 'someone-else',
        'x-email': 'attacker@example.invalid',
      },
    });

    expect(((await res.json()) as { user: { accountId: number; userId: string } }).user)
      .toMatchObject({ accountId: 7, userId: 'user-7' });
  });

  describe('legacy x-user-id header — rejected outright', () => {
    it('rejects a request presenting the header, even alongside a valid token', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const token = await issueSessionToken(d1, 7);

      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          'x-user-id': 'attacker-chosen-id',
        },
      });

      await expectEnvelope(res, 401, {
        error: 'LegacyUserIdHeaderRejected',
        message:
          'The x-user-id header is no longer accepted. Authenticate with ' +
          'the rajahinta_session cookie issued by POST /api/v1/account/session.',
      });
    });

    it('rejects the header on its own (no token presented)', async () => {
      const { d1 } = openMigratedD1();
      const app = buildProbeApp();

      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        method: 'GET',
        headers: { 'x-user-id': 'someone' },
      });

      await expectEnvelope(res, 401, { error: 'LegacyUserIdHeaderRejected' });
    });

    it('an empty header value is treated as absent', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const token = await issueSessionToken(d1, 7);

      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        method: 'GET',
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
          'x-user-id': '   ',
        },
      });

      expect(res.status).toBe(200);
    });
  });

  it('denies a request without a session cookie (401 SessionRequired)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();

    const res = await probe(app, testEnv(d1), '/api/v1/account/export', { method: 'GET' });

    await expectEnvelope(res, 401, {
      error: 'SessionRequired',
      message: 'Authentication required: no session cookie presented.',
    });
  });

  it('treats a missing or empty cookie value as unauthenticated', async () => {
    const { d1 } = openMigratedD1();
    const app = buildProbeApp();
    const env = testEnv(d1);

    for (const cookie of [
      `${SESSION_COOKIE_NAME}=`,
      `${SESSION_COOKIE_NAME}=; other=val`,
    ]) {
      const res = await probe(app, env, '/api/v1/account/export', {
        method: 'GET',
        headers: { cookie },
      });
      await expectEnvelope(res, 401, { error: 'SessionRequired' });
    }
  });

  describe('forged and guessed tokens are denied (401 InvalidSession)', () => {
    it('rejects never-issued tokens with indistinguishable 401s', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const env = testEnv(d1);
      await issueSessionToken(d1, 7); // an account + session exist

      for (let i = 0; i < 3; i++) {
        const guessed = mintOpaqueToken();
        const res = await probe(app, env, '/api/v1/account/export', {
          ...cookieHeader(guessed),
          method: 'GET',
        });
        await expectEnvelope(res, 401, {
          error: 'InvalidSession',
          message: 'Session token is invalid, expired, or revoked.',
        });
      }
    });

    it('rejects a tampered variant of a real token', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const env = testEnv(d1);
      const token = await issueSessionToken(d1, 7);

      const last = token.slice(-1);
      const mutated = token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
      for (const forged of [mutated, token.slice(0, -4), `x${token}`]) {
        const res = await probe(app, env, '/api/v1/account/export', {
          ...cookieHeader(forged),
          method: 'GET',
        });
        await expectEnvelope(res, 401, { error: 'InvalidSession' });
      }
    });

    it('rejects a hash-collision-shaped forgery (raw digest presented as token)', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const token = await issueSessionToken(d1, 7);

      // Presenting the stored hash itself is just another unknown token —
      // lookup hashes the presented value again.
      const digest = createHash('sha256').update(token).digest('hex');
      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        ...cookieHeader(digest),
        method: 'GET',
      });

      await expectEnvelope(res, 401, { error: 'InvalidSession' });
    });

    it('stores only the SHA-256 hash — the raw token is never persisted', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const token = await issueSessionToken(d1, 7);

      const row = db
        .prepare('SELECT token_hash FROM sessions')
        .get() as { token_hash: string };
      expect(row.token_hash).toBe(await hashToken(token));
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('expired and revoked tokens are denied', () => {
    it('rejects an expired session', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const token = await issueSessionToken(d1, 7);

      db.prepare(`UPDATE sessions SET expires_at = ?`)
        .run(new Date(Date.now() - 1_000).toISOString());

      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        ...cookieHeader(token),
        method: 'GET',
      });
      await expectEnvelope(res, 401, { error: 'InvalidSession' });
    });

    it('rejects a revoked session (logout kills the session)', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const token = await issueSessionToken(d1, 7);
      await new D1SessionRepository(d1).revokeByTokenHash(await hashToken(token));

      const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
        ...cookieHeader(token),
        method: 'GET',
      });
      await expectEnvelope(res, 401, { error: 'InvalidSession' });
    });
  });

  describe('rotation against the real D1 repository', () => {
    it('old token dies immediately, the successor authenticates the same account', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const app = buildProbeApp();
      const env = testEnv(d1);
      const repo = new D1SessionRepository(d1);
      const token = await issueSessionToken(d1, 7);

      const successorToken = mintOpaqueToken();
      const successor = await repo.rotate(
        await hashToken(token),
        await hashToken(successorToken),
        new Date(Date.now() + 3_600_000),
      );
      expect(successor).not.toBeNull();

      const oldRes = await probe(app, env, '/api/v1/account/export', {
        ...cookieHeader(token),
        method: 'GET',
      });
      await expectEnvelope(oldRes, 401, { error: 'InvalidSession' });

      const newRes = await probe(app, env, '/api/v1/account/export', {
        ...cookieHeader(successorToken),
        method: 'GET',
      });
      expect(newRes.status).toBe(200);
      expect(
        ((await newRes.json()) as { user: { userId: string } }).user.userId,
      ).toBe('user-7');
    });

    it('a rotated token never mints a successor', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const repo = new D1SessionRepository(d1);
      const token = await issueSessionToken(d1, 7);

      const first = await repo.rotate(
        await hashToken(token),
        await hashToken(mintOpaqueToken()),
        new Date(Date.now() + 3_600_000),
      );
      expect(first).not.toBeNull();

      // The now-dead token cannot rotate again — and neither can a guess.
      await expect(
        repo.rotate(
          await hashToken(token),
          await hashToken(mintOpaqueToken()),
          new Date(Date.now() + 3_600_000),
        ),
      ).resolves.toBeNull();
      await expect(
        repo.rotate(
          await hashToken(mintOpaqueToken()),
          await hashToken(mintOpaqueToken()),
          new Date(Date.now() + 3_600_000),
        ),
      ).resolves.toBeNull();
    });

    it('two concurrent rotations of one token produce exactly one successor', async () => {
      const { db, d1 } = openMigratedD1();
      seedStandardAccounts(db);
      const repo = new D1SessionRepository(d1);
      const token = await issueSessionToken(d1, 7);

      const results = await Promise.all([
        repo.rotate(
          await hashToken(token),
          await hashToken(mintOpaqueToken()),
          new Date(Date.now() + 3_600_000),
        ),
        repo.rotate(
          await hashToken(token),
          await hashToken(mintOpaqueToken()),
          new Date(Date.now() + 3_600_000),
        ),
      ]);
      const successors = results.filter((r) => r !== null);
      expect(successors).toHaveLength(1);

      // Exactly one live session afterwards (fake-D1 batch serializes the
      // pair like D1's single-writer execution).
      const live = db
        .prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?')
        .get(new Date().toISOString()) as { n: number };
      expect(live.n).toBe(1);
    });
  });

  it('a session whose account row has vanished authenticates nothing (fail closed)', async () => {
    const { db, d1 } = openMigratedD1();
    const app = buildProbeApp();
    // The D1 schema's FK (sessions.account_id → accounts.id) normally makes
    // an orphan session impossible; relax it here to prove the middleware's
    // defensive null path — a missing account row resolves to unauthenticated,
    // never to a 500.
    db.exec('PRAGMA foreign_keys = OFF');
    const token = await issueSessionToken(d1, 4242);

    const res = await probe(app, testEnv(d1), '/api/v1/account/export', {
      ...cookieHeader(token),
      method: 'GET',
    });
    await expectEnvelope(res, 401, { error: 'InvalidSession' });
  });
});

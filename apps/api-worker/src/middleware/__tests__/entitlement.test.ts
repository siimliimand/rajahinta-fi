/**
 * EntitlementMiddleware parity tests (task 3.2) — ported from
 * packages/application-api/src/entitlement/__tests__/entitlement.guard.test.ts.
 *
 * Uses the REAL core-domain EntitlementService (framework-free) behind the
 * middleware, so tier resolution (FEATURE_TIER_MAP, isTierSufficient,
 * AccountContext normalization) is exercised end-to-end rather than
 * mocked.
 *
 * @module EntitlementMiddlewareTest
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireFeature, toAccountContext } from '../entitlement';
import { respondToError } from '../../errors';
import { USER_CONTEXT_KEY } from '../../auth/authenticated-account';
import type { AuthenticatedAccount } from '../../auth/authenticated-account';
import type { AppEnv } from '../../env';
import { accountFixture } from './guard-test-fixtures';

/** Minimal app: sets the context user, then runs the middleware. */
function buildApp(user: unknown): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => respondToError(c, err));
  app.use('*', (c, next) => {
    if (user !== undefined) {
      c.set(USER_CONTEXT_KEY, user as AuthenticatedAccount);
    }
    return next();
  });
  app.get('/probe', requireFeature('declaration:summary'), (c) => c.json({ ok: true }));
  app.get('/free', requireFeature('product:browse'), (c) => c.json({ ok: true }));
  app.get('/pro', requireFeature('api:batch'), (c) => c.json({ ok: true }));
  return app;
}

const env = {} as AppEnv['Bindings'];

describe('EntitlementMiddleware', () => {
  describe('when no user is attached (anonymous)', () => {
    it('allows a FREE-tier feature', async () => {
      const res = await buildApp(undefined).request('/free', undefined, env);
      expect(res.status).toBe(200);
    });

    it('denies a PREMIUM feature with the service reason (403 InsufficientEntitlement)', async () => {
      const res = await buildApp(undefined).request('/probe', undefined, env);

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        statusCode: 403,
        error: 'InsufficientEntitlement',
        requiredTier: 'declaration:summary',
        currentTier: 'FREE',
        message: 'Feature "declaration:summary" requires PREMIUM tier. Sign in or upgrade.',
      });
    });
  });

  describe('when the user has sufficient tier', () => {
    it('allows a PREMIUM feature for a PREMIUM account context', async () => {
      const user = accountFixture({ tier: 'PREMIUM' });
      const res = await buildApp(user).request('/probe', undefined, env);
      expect(res.status).toBe(200);
    });

    it('allows a FREE-tier feature for a FREE account context', async () => {
      const user = accountFixture({ tier: 'FREE' });
      const res = await buildApp(user).request('/free', undefined, env);
      expect(res.status).toBe(200);
    });

    it('allows a PROFESSIONAL-tier feature for a PROFESSIONAL account context', async () => {
      const app = new Hono<AppEnv>();
      app.onError((err, c) => respondToError(c, err));
      app.use('*', (c, next) => {
        c.set(USER_CONTEXT_KEY, accountFixture({ tier: 'PROFESSIONAL' }));
        return next();
      });
      app.get('/probe', requireFeature('api:batch'), (c) => c.json({ ok: true }));

      const res = await app.request('/probe', undefined, env);
      expect(res.status).toBe(200);
    });
  });

  describe('when the user has insufficient tier', () => {
    it('denies a PROFESSIONAL feature with the current tier in the body', async () => {
      const user = accountFixture({ tier: 'PREMIUM' });
      const res = await buildApp(user).request('/pro', undefined, env);

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        statusCode: 403,
        error: 'InsufficientEntitlement',
        requiredTier: 'api:batch',
        currentTier: 'PREMIUM',
        message: 'Feature "api:batch" requires PROFESSIONAL tier. Current tier: PREMIUM.',
      });
    });
  });

  describe('toAccountContext normalization (guard parity)', () => {
    it('maps null/undefined to anonymous', () => {
      expect(toAccountContext(null)).toBeNull();
      expect(toAccountContext(undefined)).toBeNull();
    });

    it('passes a bare userId string through (Phase 1 PREMIUM default path)', () => {
      expect(toAccountContext('user-1')).toBe('user-1');
    });

    it('maps a tier-bearing context to { userId, tier }', () => {
      expect(toAccountContext(accountFixture({ userId: 'u1', tier: 'PREMIUM' }))).toEqual({
        userId: 'u1',
        tier: 'PREMIUM',
      });
    });

    it('degrades a legacy { id } shape to the id string', () => {
      expect(toAccountContext({ id: 'legacy-user' })).toBe('legacy-user');
    });

    it('degrades to null when no id and no tier are present', () => {
      expect(toAccountContext({})).toBeNull();
    });

    it('maps a tier-bearing context with legacy id field', () => {
      expect(toAccountContext({ id: 'u2', tier: 'FREE' })).toEqual({
        userId: 'u2',
        tier: 'FREE',
      });
    });
  });
});

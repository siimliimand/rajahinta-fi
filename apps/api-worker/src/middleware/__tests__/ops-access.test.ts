/**
 * OpsAccessMiddleware parity tests (task 3.2) — ported from
 * packages/application-api/src/observability/__tests__/ops-access.guard.test.ts
 * and ops/__tests__/ops-console.access.test.ts (deny-before-data cases).
 *
 * Worker-side difference under test: the client IP comes from
 * `CF-Connecting-IP` (design D5 — trustworthy by construction), NOT from
 * `X-Forwarded-For` or any proxy header.
 *
 * @module OpsAccessMiddlewareTest
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { opsAccess, opsAccessConfig, parseAllowlist } from '../ops-access';
import { respondToError } from '../../errors';
import type { AppEnv } from '../../env';
import { FAKE_OPS_TOKEN } from './guard-test-fixtures';

function envWith(vars: Record<string, string | undefined> = {}): AppEnv['Bindings'] {
  return { LOG_LEVEL: 'error', ...vars } as unknown as AppEnv['Bindings'];
}

function buildApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => respondToError(c, err));
  app.get('/ops/health', opsAccess(), (c) => c.json({ ok: true }));
  return app;
}

async function get(
  vars: Record<string, string | undefined>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return (await buildApp().request('/ops/health', { headers }, envWith(vars))) as Response;
}

/** A passing request against a token-only config. */
const TOKEN_ONLY = { OPS_BEARER_TOKEN: FAKE_OPS_TOKEN };

describe('OpsAccessMiddleware', () => {
  describe('fails closed', () => {
    it('denies when neither token nor allowlist is configured', async () => {
      const res = await get({});
      expect(res.status).toBe(403);
    });

    it('denies even a well-authenticated-looking request when unconfigured', async () => {
      const res = await get({}, {
        authorization: `Bearer ${FAKE_OPS_TOKEN}`,
        'cf-connecting-ip': '10.0.0.5',
      });
      expect(res.status).toBe(403);
    });

    it('denies with the generic body and no operational data', async () => {
      const res = await get({});
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        statusCode: 403,
        message: 'Forbidden',
        error: 'Forbidden',
      });
      expect(Object.keys(body).sort()).toEqual(
        ['error', 'message', 'path', 'statusCode', 'timestamp'].sort(),
      );
    });
  });

  describe('bearer token control', () => {
    it('admits a correct bearer token', async () => {
      const res = await get(TOKEN_ONLY, { authorization: `Bearer ${FAKE_OPS_TOKEN}` });
      expect(res.status).toBe(200);
    });

    it('denies a wrong bearer token', async () => {
      const res = await get(TOKEN_ONLY, { authorization: 'Bearer wrong' });
      expect(res.status).toBe(403);
    });

    it('denies a missing bearer token', async () => {
      const res = await get(TOKEN_ONLY, {});
      expect(res.status).toBe(403);
    });

    it('denies a non-Bearer authorization header', async () => {
      const res = await get(TOKEN_ONLY, { authorization: 'Basic c29tZXRoaW5n' });
      expect(res.status).toBe(403);
    });
  });

  describe('IP allowlist control (CF-Connecting-IP)', () => {
    const ALLOWLIST_ONLY = { OPS_IP_ALLOWLIST: '10.0.0.5' };

    it('admits an allowlisted IP with no token required', async () => {
      const res = await get(ALLOWLIST_ONLY, { 'cf-connecting-ip': '10.0.0.5' });
      expect(res.status).toBe(200);
    });

    it('denies an IP outside the allowlist', async () => {
      const res = await get(ALLOWLIST_ONLY, { 'cf-connecting-ip': '203.0.113.9' });
      expect(res.status).toBe(403);
    });

    it('denies when CF-Connecting-IP is absent', async () => {
      const res = await get(ALLOWLIST_ONLY, {});
      expect(res.status).toBe(403);
    });

    it('does NOT honour X-Forwarded-For (no proxy header)', async () => {
      const res = await get(ALLOWLIST_ONLY, {
        'x-forwarded-for': '10.0.0.5',
        'cf-connecting-ip': '203.0.113.9',
      });
      expect(res.status).toBe(403);
    });

    it('matches IPv4 CIDR entries', async () => {
      const cidr = { OPS_IP_ALLOWLIST: '10.0.0.1/24' };
      expect(
        (await get(cidr, { 'cf-connecting-ip': '10.0.0.77' })).status,
      ).toBe(200);
      expect(
        (await get(cidr, { 'cf-connecting-ip': '10.2.0.77' })).status,
      ).toBe(403);
    });

    it('matches IPv4 entries against IPv4-mapped IPv6 addresses', async () => {
      const res = await get(ALLOWLIST_ONLY, { 'cf-connecting-ip': '::ffff:10.0.0.5' });
      expect(res.status).toBe(200);
    });
  });

  describe('both controls configured (defense in depth)', () => {
    const BOTH = {
      OPS_BEARER_TOKEN: FAKE_OPS_TOKEN,
      OPS_IP_ALLOWLIST: '10.0.0.5',
    };

    it('denies the right IP with the wrong token', async () => {
      const res = await get(BOTH, {
        'cf-connecting-ip': '10.0.0.5',
        authorization: 'Bearer nope',
      });
      expect(res.status).toBe(403);
    });

    it('denies the right token from the wrong IP', async () => {
      const res = await get(BOTH, {
        'cf-connecting-ip': '203.0.113.9',
        authorization: `Bearer ${FAKE_OPS_TOKEN}`,
      });
      expect(res.status).toBe(403);
    });

    it('admits only when both controls are satisfied', async () => {
      const res = await get(BOTH, {
        'cf-connecting-ip': '10.0.0.5',
        authorization: `Bearer ${FAKE_OPS_TOKEN}`,
      });
      expect(res.status).toBe(200);
    });
  });

  describe('env-configured allowlist parsing', () => {
    it('reads a comma-separated IP + CIDR list', async () => {
      const vars = {
        OPS_BEARER_TOKEN: 'env-token',
        OPS_IP_ALLOWLIST: '10.0.0.5, 192.168.16.0/24',
      };
      expect(
        (await get(vars, {
          'cf-connecting-ip': '192.168.16.3',
          authorization: 'Bearer env-token',
        })).status,
      ).toBe(200);
      expect(
        (await get(vars, {
          'cf-connecting-ip': '10.0.0.5',
          authorization: 'Bearer wrong',
        })).status,
      ).toBe(403);
    });
  });

  describe('config + parsing helpers (guard parity)', () => {
    it('normalizes the bearer token with trim and treats blank as off', () => {
      expect(opsAccessConfig({ OPS_BEARER_TOKEN: '  tok  ' }).bearerToken).toBe('tok');
      expect(opsAccessConfig({ OPS_BEARER_TOKEN: '   ' }).bearerToken).toBeNull();
      expect(opsAccessConfig({}).bearerToken).toBeNull();
    });

    it('parses allowlist entries, ignoring malformed CIDRs', () => {
      expect(parseAllowlist('10.0.0.5, 192.168.16.0/24')).toEqual([
        { kind: 'ip', value: '10.0.0.5' },
        { kind: 'cidr', address: 192 * 256 ** 3 + 168 * 256 ** 2 + 16 * 256, prefixBits: 24 },
      ]);
      expect(parseAllowlist('10.0.0.5, 300.1.2.3/24')).toEqual([
        { kind: 'ip', value: '10.0.0.5' },
      ]);
      expect(parseAllowlist(undefined)).toEqual([]);
      expect(parseAllowlist('   ')).toEqual([]);
    });
  });
});

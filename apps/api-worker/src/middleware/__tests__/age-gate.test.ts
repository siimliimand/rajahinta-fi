/**
 * AgeGateMiddleware parity tests (task 3.2) — ported from
 * packages/application-api/src/age-gate/__tests__/age-gate.guard.test.ts.
 *
 * Phase 1 uses simple confirmation (no identity documents, no DOB). The
 * middleware checks the `x-age-confirmed` header / `age_confirmed` cookie
 * and delegates to the injected provider.
 *
 * @module AgeGateMiddlewareTest
 */

import { describe, it, expect } from 'vitest';
import { Hono, type Context } from 'hono';
import {
  ageGate,
  extractConfirmationToken,
  simpleConfirmationProvider,
  type IVerificationProvider,
} from '../age-gate';
import { respondToError } from '../../errors';
import type { AppEnv } from '../../env';

/** Provider that records calls and can be told to reject. */
class RecordingProvider implements IVerificationProvider {
  readonly verifyCalls: string[] = [];
  constructor(private readonly verified: boolean) {}
  async verifyAge(_userId: string) {
    this.verifyCalls.push(_userId);
    return {
      verified: this.verified,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }
  async upgradeVerification(_userId: string, _method: string) {
    return {
      verified: this.verified,
      method: 'simple-confirmation',
      timestamp: new Date(),
    };
  }
}

function buildApp(provider: IVerificationProvider = simpleConfirmationProvider): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => respondToError(c, err));
  app.get('/probe', ageGate(provider), (c) => c.json({ ok: true }));
  return app;
}

describe('AgeGateMiddleware', () => {
  describe('when no confirmation token is present', () => {
    it('denies with empty headers and cookies', async () => {
      const res = await buildApp().request('/probe');
      expect(res.status).toBe(403);
      const body = (await res.json()) as { message: string; error: string };
      expect(body.message).toMatch(/age confirmation required/i);
      expect(body.error).toBe('Forbidden');
    });

    it('denies an empty x-age-confirmed header', async () => {
      const res = await buildApp().request('/probe', {
        headers: { 'x-age-confirmed': '' },
      });
      expect(res.status).toBe(403);
    });

    it('denies an empty age_confirmed cookie', async () => {
      const res = await buildApp().request('/probe', {
        headers: { cookie: 'age_confirmed=' },
      });
      expect(res.status).toBe(403);
    });

    it('carries no DOB or identity-document fields in the rejection payload', async () => {
      const res = await buildApp().request('/probe');
      const body = (await res.json()) as Record<string, unknown>;
      for (const key of Object.keys(body)) {
        expect(['dateOfBirth', 'dob', 'identityDocument', 'documentNumber', 'nationalId'])
          .not.toContain(key);
      }
    });
  });

  describe('when a valid confirmation token is present', () => {
    it('admits via the x-age-confirmed header', async () => {
      const res = await buildApp().request('/probe', {
        headers: { 'x-age-confirmed': 'confirmed' },
      });
      expect(res.status).toBe(200);
    });

    it('admits via the age_confirmed cookie', async () => {
      const res = await buildApp().request('/probe', {
        headers: { cookie: 'age_confirmed=1' },
      });
      expect(res.status).toBe(200);
    });

    it('parses age_confirmed from a multi-cookie header string', async () => {
      const res = await buildApp().request('/probe', {
        headers: { cookie: 'session=xyz; age_confirmed=yes; theme=dark' },
      });
      expect(res.status).toBe(200);
    });

    it('parses age_confirmed with surrounding whitespace in the cookie header', async () => {
      const res = await buildApp().request('/probe', {
        headers: {
          cookie: 'session=xyz;   age_confirmed=whitespace-trimmed  ; theme=dark',
        },
      });
      expect(res.status).toBe(200);
    });

    it('the header takes priority over the cookie', async () => {
      const provider = new RecordingProvider(true);
      const app = new Hono<AppEnv>();
      app.onError((err, c) => respondToError(c, err));
      app.get('/probe', ageGate(provider), (c) => c.json({ ok: true }));

      const res = await app.request('/probe', {
        headers: {
          'x-age-confirmed': 'header-token',
          cookie: 'age_confirmed=cookie-token',
        },
      });

      expect(res.status).toBe(200);
      // Guard parity: the provider receives the extracted (header) token.
      expect(provider.verifyCalls).toEqual(['header-token']);
    });
  });

  describe('when the provider rejects the token', () => {
    it('denies with the verification-failed message', async () => {
      const res = await buildApp(new RecordingProvider(false)).request('/probe', {
        headers: { 'x-age-confirmed': 'some-token' },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { message: string };
      expect(body.message).toMatch(/age verification failed/i);
    });

    it('passes the presented token to the provider as the verification subject', async () => {
      const provider = new RecordingProvider(true);
      await buildApp(provider).request('/probe', {
        headers: { cookie: 'age_confirmed=cookie-token-42' },
      });
      expect(provider.verifyCalls).toEqual(['cookie-token-42']);
    });
  });

  describe('extractConfirmationToken (guard helper parity)', () => {
    /** Capture a REAL Hono context for the pure helper. */
    async function captureContext(
      headers: Record<string, string>,
    ): Promise<Context<AppEnv>> {
      let captured: Context<AppEnv> | undefined;
      const app = new Hono<AppEnv>();
      app.get('/capture', (c) => {
        captured = c;
        return c.json({ ok: true });
      });
      await app.request('/capture', { headers });
      if (!captured) throw new Error('context was not captured');
      return captured;
    }

    it('prefers the header over the cookie', async () => {
      const c = await captureContext({
        'x-age-confirmed': 'hdr',
        cookie: 'age_confirmed=cookie',
      });
      expect(extractConfirmationToken(c)).toBe('hdr');
    });

    it('falls back to the cookie when the header is absent or empty', async () => {
      expect(
        extractConfirmationToken(await captureContext({ cookie: 'age_confirmed=ck' })),
      ).toBe('ck');
      expect(
        extractConfirmationToken(
          await captureContext({ 'x-age-confirmed': '', cookie: 'age_confirmed=ck' }),
        ),
      ).toBe('ck');
    });

    it('returns undefined when neither is present', async () => {
      expect(extractConfirmationToken(await captureContext({}))).toBeUndefined();
    });
  });
});

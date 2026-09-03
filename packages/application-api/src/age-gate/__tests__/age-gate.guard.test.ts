/**
 * AgeGateGuard tests — confirmation semantics.
 *
 * Phase 1 uses simple confirmation (no identity documents, no DOB).
 * The guard checks for an `x-age-confirmed` header or `age_confirmed`
 * cookie and delegates to {@link AgeGateService} for verification.
 *
 * ## Public-route exemption
 *
 * Routes without `@UseGuards(AgeGateGuard)` are naturally exempt — the
 * guard only runs when explicitly applied. This is inherent in NestJS's
 * guard dispatch and not tested here at the unit level.
 *
 * @module AgeGateGuardTest
 */

import { describe, it, expect } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { AgeGateGuard } from '../age-gate.guard';
import { AgeGateService } from '../age-gate.service';
import { SimpleConfirmationProvider } from '../simple-confirmation.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an ExecutionContext with the given request shape. */
function mockContext(overrides?: {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        headers: overrides?.headers ?? {},
        cookies: overrides?.cookies ?? {},
      }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgeGateGuard', () => {
  /** Shared service instance — stateless, safe to reuse across tests. */
  const service = new AgeGateService(new SimpleConfirmationProvider());

  // -----------------------------------------------------------------------
  // No token → ForbiddenException
  // -----------------------------------------------------------------------

  describe('when no confirmation token is present', () => {
    it('throws ForbiddenException with empty headers and cookies', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({ headers: {}, cookies: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when request has no headers at all', async () => {
      const guard = new AgeGateGuard(service);
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as ExecutionContext;

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for an empty x-age-confirmed header', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: { 'x-age-confirmed': '' },
        cookies: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for an empty age_confirmed cookie', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: {},
        cookies: { age_confirmed: '' },
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when x-age-confirmed is an array (not a string)', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: { 'x-age-confirmed': ['token1', 'token2'] },
        cookies: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('includes a descriptive message and AGE_GATE_REQUIRED code in the ForbiddenException', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({ headers: {}, cookies: {} });

      try {
        await guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/age confirmation required/i);

        // Nest-parity rejection body — mirrors the Hono Worker port
        // byte-compatibly (task: age-gate-recovery).
        const response = fb.getResponse() as {
          statusCode: number;
          message: string;
          error: string;
          code: string;
        };
        expect(response.statusCode).toBe(403);
        expect(response.message).toBe(
          'Age confirmation required. Please confirm your age via the age-gate prompt.',
        );
        expect(response.error).toBe('Forbidden');
        expect(response.code).toBe('AGE_GATE_REQUIRED');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Valid token → returns true
  // -----------------------------------------------------------------------

  describe('when a valid confirmation token is present', () => {
    it('returns true via x-age-confirmed header', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: { 'x-age-confirmed': 'confirmed' },
        cookies: {},
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('returns true via age_confirmed cookie (cookie-parser path)', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: {},
        cookies: { age_confirmed: '1' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('falls back to raw Cookie header when cookies object is absent', async () => {
      const guard = new AgeGateGuard(service);
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { cookie: 'age_confirmed=abc123; other=val' },
          }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('header takes priority over cookie when both are present', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({
        headers: { 'x-age-confirmed': 'header-token' },
        cookies: { age_confirmed: 'cookie-token' },
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('parses age_confirmed from a multi-cookie header string', async () => {
      const guard = new AgeGateGuard(service);
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              cookie: 'session=xyz; age_confirmed=yes; theme=dark',
            },
          }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('parses age_confirmed with surrounding whitespace in the cookie header', async () => {
      const guard = new AgeGateGuard(service);
      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({
            headers: {
              cookie: 'session=xyz;   age_confirmed=whitespace-trimmed  ; theme=dark',
            },
          }),
        }),
        getArgs: () => [],
        getType: () => 'http',
      } as ExecutionContext;

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Policy assertion: no DOB or identity document collection
  // -----------------------------------------------------------------------

  describe('privacy: no DOB or identity documents', () => {
    /**
     * Phase 1 uses simple confirmation — the guard never collects or
     * transmits dates of birth or identity documents. The
     * VerificationResult shape is exhaustively checked in
     * `age-gate.service.test.ts`. This test verifies the guard itself
     * does not introduce DOB/document fields in its ForbiddenException
     * response payload.
     */
    it('ForbiddenException response does not contain DOB or document fields', async () => {
      const guard = new AgeGateGuard(service);
      const context = mockContext({ headers: {}, cookies: {} });

      try {
        await guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        const response = fb.getResponse();
        if (typeof response === 'object' && response !== null) {
          const keys = Object.keys(response);
          expect(keys).not.toContain('dateOfBirth');
          expect(keys).not.toContain('dob');
          expect(keys).not.toContain('identityDocument');
          expect(keys).not.toContain('documentNumber');
          expect(keys).not.toContain('nationalId');
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // AgeGateService rejection case
  // -----------------------------------------------------------------------

  describe('when AgeGateService rejects the token', () => {
    it('throws ForbiddenException when service returns unverified', async () => {
      // A service that always rejects verification
      const rejectingService = new AgeGateService({
        verifyAge: async () => ({
          verified: false,
          method: 'simple-confirmation',
          timestamp: new Date(),
        }),
        upgradeVerification: async () => ({
          verified: false,
          method: 'simple-confirmation',
          timestamp: new Date(),
        }),
      });

      const guard = new AgeGateGuard(rejectingService);
      const context = mockContext({
        headers: { 'x-age-confirmed': 'some-token' },
        cookies: {},
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('error message references verification failure with AGE_VERIFICATION_FAILED code', async () => {
      const rejectingService = new AgeGateService({
        verifyAge: async () => ({
          verified: false,
          method: 'simple-confirmation',
          timestamp: new Date(),
        }),
        upgradeVerification: async () => ({
          verified: false,
          method: 'simple-confirmation',
          timestamp: new Date(),
        }),
      });

      const guard = new AgeGateGuard(rejectingService);
      const context = mockContext({
        headers: { 'x-age-confirmed': 'some-token' },
        cookies: {},
      });

      try {
        await guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/age verification failed/i);

        // Nest-parity rejection body — mirrors the Hono Worker port
        // byte-compatibly (task: age-gate-recovery).
        const response = fb.getResponse() as {
          statusCode: number;
          message: string;
          error: string;
          code: string;
        };
        expect(response.statusCode).toBe(403);
        expect(response.message).toBe(
          'Age verification failed. Please try confirming your age again.',
        );
        expect(response.error).toBe('Forbidden');
        expect(response.code).toBe('AGE_VERIFICATION_FAILED');
      }
    });
  });
});
/**
 * Regression test: CalculatorController guard application on getResult.
 *
 * Task 9.1 covers the HTTP layer (supertest).  This test verifies at the
 * metadata + guard-unit level that `getResult` is properly protected:
 *
 *   1. The class-level `@UseGuards(RateLimitGuard, AgeGateGuard)`
 *      is correctly inherited by the `getResult` handler via NestJS metadata.
 *   2. AgeGateGuard rejects `getResult` when no age confirmation token is sent,
 *      with the machine-readable AGE_GATE_REQUIRED code on the rejection body.
 *
 * @module CalculatorGuardRegressionTest
 */

import { describe, it, expect } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CalculatorController,
} from '../calculator.controller';
import { RateLimitGuard } from '../../rate-limiting/rate-limit.guard';
import { AgeGateGuard } from '../../age-gate/age-gate.guard';
import { AgeGateService } from '../../age-gate/age-gate.service';
import { SimpleConfirmationProvider } from '../../age-gate/simple-confirmation.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

/** Constructor reference for a NestJS guard — not instantiated through this type, only compared. */
type GuardConstructor = abstract new (...args: never[]) => unknown;

/**
 * Build an ExecutionContext that points at a specific controller method.
 * @param handler The controller method — never invoked through this type, only stored for metadata reflection.
 */
function contextForMethod<F>(
  handler: F,
  controller: object,
  requestOverrides?: {
    headers?: Record<string, string | string[] | undefined>;
    cookies?: Record<string, string | undefined>;
  },
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        headers: requestOverrides?.headers ?? {},
        cookies: requestOverrides?.cookies ?? {},
      }),
      getResponse: () => ({
        header: () => undefined,
      }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CalculatorController — getResult guard regression', () => {
  const reflector = new Reflector();

  // ===================================================================
  // Guard metadata inheritance
  // ===================================================================

  describe('guard metadata inheritance', () => {
    it('inherits class-level @UseGuards metadata for getResult', () => {
      const guards = reflector.getAllAndOverride<GuardConstructor[]>(
        GUARDS_METADATA,
        [
          CalculatorController.prototype.getResult,
          CalculatorController,
        ],
      );

      expect(guards).toBeDefined();
      expect(guards).toHaveLength(2);
      expect(guards).toContain(RateLimitGuard);
      expect(guards).toContain(AgeGateGuard);
    });

    it('class metadata is defined (smoke check — guards exist at class level)', () => {
      // Direct metadata check — this confirms decorators were applied at all
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, CalculatorController);
      expect(classGuards).toBeDefined();
      expect(classGuards).toHaveLength(2);
    });

    it('getResult handler does NOT have method-level guards (inherits from class)', () => {
      // Method-level metadata should be undefined; only class-level is set
      const methodGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        CalculatorController.prototype.getResult,
      );
      expect(methodGuards).toBeUndefined();
    });
  });

  // ===================================================================
  // AgeGateGuard rejection for getResult
  // ===================================================================

  describe('AgeGateGuard rejects getResult when age token is missing', () => {
    const service = new AgeGateService(new SimpleConfirmationProvider());

    it('throws ForbiddenException when no age confirmation header or cookie', async () => {
      const guard = new AgeGateGuard(service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
        { headers: {}, cookies: {} },
      );

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with a descriptive message', async () => {
      const guard = new AgeGateGuard(service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
        { headers: {}, cookies: {} },
      );

      try {
        await guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/age confirmation required/i);
        // Regression: the rejection body must keep the machine-readable code
        // the frontend recovery flow dispatches on (age-gate-recovery 1.3).
        const body = fb.getResponse() as { code?: string };
        expect(body.code).toBe('AGE_GATE_REQUIRED');
      }
    });

    it('allows access when x-age-confirmed header is present', async () => {
      const guard = new AgeGateGuard(service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
        { headers: { 'x-age-confirmed': 'test-token' }, cookies: {} },
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});

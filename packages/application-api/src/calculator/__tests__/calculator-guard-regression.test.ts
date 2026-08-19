/**
 * Regression test: CalculatorController guard application on getResult.
 *
 * Task 9.1 covers the HTTP layer (supertest).  This test verifies at the
 * metadata + guard-unit level that `getResult` is properly protected:
 *
 *   1. The class-level `@UseGuards(RateLimitGuard, LaunchGateGuard, AgeGateGuard)`
 *      is correctly inherited by the `getResult` handler via NestJS metadata.
 *   2. The class-level `@LaunchGate(LaunchGateType.CALCULATION)` metadata is
 *      correctly inherited by `getResult`.
 *   3. AgeGateGuard rejects `getResult` when no age confirmation token is sent.
 *   4. LaunchGateGuard rejects `getResult` when launch gates are closed.
 *   5. LaunchGateGuard allows `getResult` when the override env var is set.
 *
 * @module CalculatorGuardRegressionTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CalculatorController,
} from '../calculator.controller';
import {
  LaunchGateGuard,
  LaunchGateType,
  LAUNCH_GATE_KEY,
} from '../../feature-flags/launch-gate.guard';
import { LaunchGateService } from '../../feature-flags/launch-gate.service';
import { GATE_ENV_KEYS } from '../../feature-flags/launch-gate.types';
import { RateLimitGuard } from '../../rate-limiting/rate-limit.guard';
import { AgeGateGuard } from '../../age-gate/age-gate.guard';
import { AgeGateService } from '../../age-gate/age-gate.service';
import { SimpleConfirmationProvider } from '../../age-gate/simple-confirmation.provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

/**
 * Build an ExecutionContext that points at a specific controller method.
 * This lets guards / the Reflector walk the handler→class metadata chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GuardConstructor = abstract new (...args: any[]) => unknown;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handler is only used for metadata reflection, never invoked
type AnyFunction = (...args: any[]) => any;

function contextForMethod(
  handler: AnyFunction,
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
      expect(guards).toHaveLength(3);
      expect(guards).toContain(RateLimitGuard);
      expect(guards).toContain(LaunchGateGuard);
      expect(guards).toContain(AgeGateGuard);
    });

    it('inherits class-level @LaunchGate(CALCULATION) metadata for getResult', () => {
      const gateType = reflector.getAllAndOverride<LaunchGateType>(
        LAUNCH_GATE_KEY,
        [
          CalculatorController.prototype.getResult,
          CalculatorController,
        ],
      );

      expect(gateType).toBe(LaunchGateType.CALCULATION);
    });

    it('class metadata is defined (smoke check — guards exist at class level)', () => {
      // Direct metadata check — this confirms decorators were applied at all
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, CalculatorController);
      expect(classGuards).toBeDefined();
      expect(classGuards).toHaveLength(3);

      const classGateType = Reflect.getMetadata(LAUNCH_GATE_KEY, CalculatorController);
      expect(classGateType).toBe(LaunchGateType.CALCULATION);
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

  // ===================================================================
  // LaunchGateGuard rejection for getResult
  // ===================================================================

  describe('LaunchGateGuard guards getResult when gates are closed', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env[GATE_ENV_KEYS.legalOpinion];
      delete process.env[GATE_ENV_KEYS.taxSourceMapping];
      delete process.env[GATE_ENV_KEYS.correctionMechanism];
      delete process.env[GATE_ENV_KEYS.override];
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('throws ForbiddenException when all gates are OFF', () => {
      const reflector = new Reflector();
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
      );

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with a message referencing calculations', () => {
      const reflector = new Reflector();
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
      );

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/calculations?/i);
      }
    });

    it('allows access when LAUNCH_GATES_OVERRIDE=true', () => {
      process.env[GATE_ENV_KEYS.override] = 'true';
      const reflector = new Reflector();
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = contextForMethod(
        CalculatorController.prototype.getResult,
        CalculatorController,
      );

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
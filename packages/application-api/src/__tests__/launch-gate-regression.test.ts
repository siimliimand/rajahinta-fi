/**
 * Regression test: LaunchGateGuard blocks CALCULATION and PRICE_DATA
 * endpoints when gates are off (default → safe).
 *
 * Verifies:
 *   1. Guard throws ForbiddenException for CALCULATION when gates are closed.
 *   2. Guard throws ForbiddenException for PRICE_DATA when gates are closed.
 *   3. Guard allows access when LAUNCH_GATES_OVERRIDE=true.
 *   4. Guard allows access when no gate metadata is set.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  LaunchGateGuard,
  LaunchGateType,
  LAUNCH_GATE_KEY,
} from '../feature-flags/launch-gate.guard';
import { LaunchGateService } from '../feature-flags/launch-gate.service';
import { GATE_ENV_KEYS } from '../feature-flags/launch-gate.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Reflector that returns a fixed gate type. */
function mockReflector(gateType: LaunchGateType | null): Reflector {
  return {
    getAllAndOverride: (key: string) => {
      if (key === LAUNCH_GATE_KEY) return gateType;
      return undefined;
    },
    get: () => undefined,
  } as unknown as Reflector;
}

/** Minimal ExecutionContext with getHandler / getClass stubs. */
function mockContext(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({}),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LaunchGateGuard (regression)', () => {
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

  // -----------------------------------------------------------------------
  // Default: all gates OFF
  // -----------------------------------------------------------------------

  describe('when all gates are OFF (default)', () => {
    it('throws ForbiddenException for CALCULATION gate', () => {
      const reflector = mockReflector(LaunchGateType.CALCULATION);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for PRICE_DATA gate', () => {
      const reflector = mockReflector(LaunchGateType.PRICE_DATA);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it('throws an error message referencing the specific gate type for CALCULATION', () => {
      const reflector = mockReflector(LaunchGateType.CALCULATION);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/calculations?/i);
      }
    });

    it('throws an error message referencing the specific gate type for PRICE_DATA', () => {
      const reflector = mockReflector(LaunchGateType.PRICE_DATA);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      try {
        guard.canActivate(context);
        expect.unreachable('Expected ForbiddenException');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const fb = err as ForbiddenException;
        expect(fb.message).toMatch(/price data/i);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Override ON — all gates forced open
  // -----------------------------------------------------------------------

  describe('when LAUNCH_GATES_OVERRIDE=true', () => {
    beforeEach(() => {
      process.env[GATE_ENV_KEYS.override] = 'true';
    });

    it('allows access for CALCULATION gate', () => {
      const reflector = mockReflector(LaunchGateType.CALCULATION);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      expect(guard.canActivate(context)).toBe(true);
    });

    it('allows access for PRICE_DATA gate', () => {
      const reflector = mockReflector(LaunchGateType.PRICE_DATA);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      expect(guard.canActivate(context)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // No gate metadata set
  // -----------------------------------------------------------------------

  describe('when no gate metadata is set', () => {
    it('returns true (no gate → allow)', () => {
      const reflector = mockReflector(null);
      const service = new LaunchGateService();
      const guard = new LaunchGateGuard(reflector, service);
      const context = mockContext();

      expect(guard.canActivate(context)).toBe(true);
    });
  });
});
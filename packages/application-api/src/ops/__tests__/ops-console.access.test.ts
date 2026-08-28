/**
 * Operator-console access-regression tests (task 12.1, change
 * technical-assessment-remediation).
 *
 * The spec scenarios that gate everything else: unauthenticated or
 * non-operator callers are denied BEFORE any operational data is returned,
 * and the console is dark while the OPERATOR_CONSOLE flag is off
 * (compliance rule: new UI ships flag-off). Also exercises the
 * OpsAuditTrailService read over the durable audit store.
 *
 * Guards run against a real controller instance so the metadata
 * (@FeatureFlagDec) is exactly what production sees — the sibling
 * guard-regression convention from the merchants suite.
 *
 * @module OpsConsoleGuardTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '@rajahinta/core-domain';
import { InMemoryAuditRepository } from '../../audit/in-memory-audit.repository';
import {
  FeatureFlagGuard,
  FeatureFlag,
  FEATURE_FLAG_KEY,
} from '../../feature-flags';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import { OpsAccessGuard } from '../../observability/ops-access.guard';
import { OpsAuditTrailController } from '../audit/ops-audit-trail.controller';
import { OpsAuditTrailService } from '../audit/ops-audit-trail.service';

/** Fake HTTP context carrying the request shape the guards read. */
function context(request: {
  ip?: string;
  headers?: Record<string, string>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => OpsAuditTrailController.prototype.recent,
    getClass: () => OpsAuditTrailController,
  } as unknown as ExecutionContext;
}

const AUTHED = { ip: '10.0.0.5', headers: { authorization: 'Bearer ops-secret' } };

describe('operator console access', () => {
  describe('OpsAccessGuard — deny before any data', () => {
    it('fails closed when unconfigured', () => {
      const guard = new OpsAccessGuard({ bearerToken: null, allowlist: [] });
      expect(() => guard.canActivate(context(AUTHED))).toThrow(ForbiddenException);
    });

    it('denies a missing or wrong bearer token', () => {
      const guard = new OpsAccessGuard({ bearerToken: 'ops-secret', allowlist: [] });
      expect(() => guard.canActivate(context({ ip: '10.0.0.5' }))).toThrow(ForbiddenException);
      expect(() =>
        guard.canActivate(context({ ip: '10.0.0.5', headers: { authorization: 'Bearer nope' } })),
      ).toThrow(ForbiddenException);
    });

    it('denies an allowlisted host without the token and an outside IP with it', () => {
      const guard = new OpsAccessGuard({
        bearerToken: 'ops-secret',
        allowlist: [{ kind: 'cidr', address: 0x0a000000, prefixBits: 24 }],
      });
      expect(() => guard.canActivate(context({ ip: '10.0.0.5' }))).toThrow(ForbiddenException);
      expect(() =>
        guard.canActivate(context({ ip: '203.0.113.9', headers: AUTHED.headers })),
      ).toThrow(ForbiddenException);
    });

    it('admits token + allowlist together', () => {
      const guard = new OpsAccessGuard({
        bearerToken: 'ops-secret',
        allowlist: [{ kind: 'ip', value: '10.0.0.5' }],
      });
      expect(guard.canActivate(context(AUTHED))).toBe(true);
    });
  });

  describe('FeatureFlagGuard — OPERATOR_CONSOLE gates the surface', () => {
    let flagService: FeatureFlagService;
    let guard: FeatureFlagGuard;
    let original: string | undefined;

    beforeEach(() => {
      original = process.env.FF_OPERATOR_CONSOLE;
      flagService = new FeatureFlagService();
      guard = new FeatureFlagGuard(new Reflector(), flagService);
    });

    afterEach(() => {
      if (original === undefined) delete process.env.FF_OPERATOR_CONSOLE;
      else process.env.FF_OPERATOR_CONSOLE = original;
    });

    it('is dark while the flag is off (default) even for authenticated operators', () => {
      expect(flagService.isEnabled(FeatureFlag.OPERATOR_CONSOLE)).toBe(false);
      expect(() => guard.canActivate(context(AUTHED))).toThrow(ForbiddenException);
    });

    it('admits when the flag is enabled', () => {
      process.env.FF_OPERATOR_CONSOLE = 'true';
      const enabled = new FeatureFlagGuard(new Reflector(), new FeatureFlagService());
      expect(enabled.canActivate(context(AUTHED))).toBe(true);
    });

    it('the console controller metadata carries the OPERATOR_CONSOLE flag', () => {
      const reflector = new Reflector();
      const flag = reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        OpsAuditTrailController.prototype.recent,
        OpsAuditTrailController,
      ]);
      expect(flag).toBe(FeatureFlag.OPERATOR_CONSOLE);
    });
  });

  describe('OpsAuditTrailService — trail readable per action', () => {
    it('returns recent entries newest-first with clamped limits', async () => {
      const auditRepo = new InMemoryAuditRepository();
      const audit = new AuditService(auditRepo);
      const controller = new OpsAuditTrailController(new OpsAuditTrailService(audit));

      await audit.logChange({
        entityType: 'source_governance',
        entityId: 'b-systembolaget',
        action: 'created',
        author: 'first@rajahinta.fi',
        reason: 'grant 1',
      });
      // Distinct milliseconds so newest-first ordering is deterministic.
      await new Promise((resolve) => setTimeout(resolve, 3));
      await audit.logChange({
        entityType: 'fx_rate_dataset',
        entityId: 'ecb-2026-08-28',
        action: 'confirmed',
        author: 'second@rajahinta.fi',
        reason: 'confirm 1',
      });

      const recent = await controller.recent(undefined);
      expect(recent.total).toBe(2);
      expect(recent.items[0].author).toBe('second@rajahinta.fi'); // newest first
      expect(recent.items[0].entityType).toBe('fx_rate_dataset');

      const one = await controller.recent('1');
      expect(one.items).toHaveLength(1);

      const clamped = await controller.recent('5000');
      expect(clamped.items).toHaveLength(2);
    });
  });
});

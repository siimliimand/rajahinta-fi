/**
 * Launch-gate parity tests (task 3.2) — ported from
 * packages/application-api/src/__tests__/launch-gate.service.test.ts and
 * launch-gate-regression.test.ts. Service-level cases run against the
 * ported LaunchGateService; guard-level cases against the middleware over
 * a probe app.
 *
 * @module LaunchGateTest
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  LaunchGateService,
  requireLaunchGate,
  GATE_ENV_KEYS,
  DEFAULT_GATE_STATUS,
  type LaunchGateType,
} from '../launch-gate';
import { respondToError } from '../../errors';
import type { AppEnv } from '../../env';

/** Env with every launch-gate var cleared (default = all gates OFF). */
function envWith(vars: Record<string, string> = {}): AppEnv['Bindings'] {
  return { ...vars } as unknown as AppEnv['Bindings'];
}

function buildApp(gateType: LaunchGateType): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError((err, c) => respondToError(c, err));
  app.get('/probe', requireLaunchGate(gateType), (c) => c.json({ ok: true }));
  return app;
}

describe('LaunchGateService', () => {
  describe('default state (all gates OFF)', () => {
    it('has all gates disabled by default', () => {
      const status = new LaunchGateService(envWith()).getGateStatus();
      expect(status).toEqual(DEFAULT_GATE_STATUS);
      expect(status.launchReady).toBe(false);
    });

    it('disables calculations by default', () => {
      expect(new LaunchGateService(envWith()).isCalculationEnabled()).toBe(false);
    });

    it('hides price data by default', () => {
      expect(new LaunchGateService(envWith()).isPriceDataVisible()).toBe(false);
    });
  });

  describe('individual gate overrides', () => {
    it('enables the legal opinion gate alone without launchReady', () => {
      const status = new LaunchGateService(
        envWith({ [GATE_ENV_KEYS.legalOpinion]: 'true' }),
      ).getGateStatus();
      expect(status.legalOpinionConfirmed).toBe(true);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('enables the tax source mapping gate alone without launchReady', () => {
      const status = new LaunchGateService(
        envWith({ [GATE_ENV_KEYS.taxSourceMapping]: 'true' }),
      ).getGateStatus();
      expect(status.taxSourceMappingConfirmed).toBe(true);
      expect(status.launchReady).toBe(false);
    });

    it('enables the correction mechanism gate alone without launchReady', () => {
      const status = new LaunchGateService(
        envWith({ [GATE_ENV_KEYS.correctionMechanism]: 'true' }),
      ).getGateStatus();
      expect(status.correctionMechanismConfirmed).toBe(true);
      expect(status.launchReady).toBe(false);
    });

    it('requires ALL gates for launchReady', () => {
      const service = new LaunchGateService(
        envWith({
          [GATE_ENV_KEYS.legalOpinion]: 'true',
          [GATE_ENV_KEYS.taxSourceMapping]: 'true',
          [GATE_ENV_KEYS.correctionMechanism]: 'true',
        }),
      );
      expect(service.getGateStatus().launchReady).toBe(true);
      expect(service.isCalculationEnabled()).toBe(true);
      expect(service.isPriceDataVisible()).toBe(true);
    });

    it('hides price data when any single gate is off', () => {
      const twoGates: Record<string, string> = {
        [GATE_ENV_KEYS.taxSourceMapping]: 'true',
        [GATE_ENV_KEYS.correctionMechanism]: 'true',
      };
      expect(new LaunchGateService(envWith(twoGates)).isPriceDataVisible()).toBe(false);

      delete twoGates[GATE_ENV_KEYS.taxSourceMapping];
      twoGates[GATE_ENV_KEYS.legalOpinion] = 'true';
      expect(new LaunchGateService(envWith(twoGates)).isPriceDataVisible()).toBe(false);

      delete twoGates[GATE_ENV_KEYS.correctionMechanism];
      twoGates[GATE_ENV_KEYS.taxSourceMapping] = 'true';
      expect(new LaunchGateService(envWith(twoGates)).isPriceDataVisible()).toBe(false);
    });

    it('keeps price-data visibility identical to calculation enablement', () => {
      const states: Array<Record<string, string>> = [
        {},
        { [GATE_ENV_KEYS.legalOpinion]: 'true' },
        { [GATE_ENV_KEYS.taxSourceMapping]: 'true' },
        { [GATE_ENV_KEYS.correctionMechanism]: 'true' },
        {
          [GATE_ENV_KEYS.legalOpinion]: 'true',
          [GATE_ENV_KEYS.taxSourceMapping]: 'true',
          [GATE_ENV_KEYS.correctionMechanism]: 'true',
        },
      ];
      for (const state of states) {
        const service = new LaunchGateService(envWith(state));
        expect(service.isPriceDataVisible()).toBe(service.isCalculationEnabled());
      }
    });
  });

  describe('global override', () => {
    it('forces all gates open with LAUNCH_GATES_OVERRIDE=true', () => {
      const service = new LaunchGateService(
        envWith({
          [GATE_ENV_KEYS.override]: 'true',
          [GATE_ENV_KEYS.legalOpinion]: 'false',
          [GATE_ENV_KEYS.taxSourceMapping]: 'false',
          [GATE_ENV_KEYS.correctionMechanism]: 'false',
        }),
      );
      const status = service.getGateStatus();
      expect(status).toEqual({
        legalOpinionConfirmed: true,
        taxSourceMappingConfirmed: true,
        correctionMechanismConfirmed: true,
        launchReady: true,
      });
      expect(service.isCalculationEnabled()).toBe(true);
      expect(service.isPriceDataVisible()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('treats non-"true" values as false (strict parity)', () => {
      const status = new LaunchGateService(
        envWith({
          [GATE_ENV_KEYS.legalOpinion]: 'yes',
          [GATE_ENV_KEYS.taxSourceMapping]: '1',
          [GATE_ENV_KEYS.correctionMechanism]: 'TRUE',
        }),
      ).getGateStatus();
      expect(status.legalOpinionConfirmed).toBe(false);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('returns a defensive copy from getGateStatus', () => {
      const service = new LaunchGateService(envWith());
      const status1 = service.getGateStatus();
      const status2 = service.getGateStatus();
      expect(status1).not.toBe(status2);
      expect(status1).toEqual(status2);
    });
  });
});

describe('requireLaunchGate middleware (guard regression parity)', () => {
  it('denies CALCULATION while gates are closed, with the exact message', async () => {
    const res = await buildApp('CALCULATION').request('/probe', undefined, envWith());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string; error: string };
    expect(body.message).toMatch(/calculations?/i);
    expect(body.message).toMatch(/not yet publicly available/i);
    expect(body.message).toMatch(/all launch gates/i);
    expect(body.error).toBe('Forbidden');
  });

  it('denies PRICE_DATA while gates are closed, with the exact message', async () => {
    const res = await buildApp('PRICE_DATA').request('/probe', undefined, envWith());

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string; error: string };
    expect(body.message).toMatch(/price data/i);
    expect(body.message).toMatch(/not yet publicly available/i);
    expect(body.message).toMatch(/all launch gates/i);
  });

  it('admits both gate types when LAUNCH_GATES_OVERRIDE=true', async () => {
    const open = envWith({ [GATE_ENV_KEYS.override]: 'true' });
    expect((await buildApp('CALCULATION').request('/probe', undefined, open)).status).toBe(200);
    expect((await buildApp('PRICE_DATA').request('/probe', undefined, open)).status).toBe(200);
  });

  it('admits when all three gates are individually confirmed', async () => {
    const open = envWith({
      [GATE_ENV_KEYS.legalOpinion]: 'true',
      [GATE_ENV_KEYS.taxSourceMapping]: 'true',
      [GATE_ENV_KEYS.correctionMechanism]: 'true',
    });
    expect((await buildApp('CALCULATION').request('/probe', undefined, open)).status).toBe(200);
    expect((await buildApp('PRICE_DATA').request('/probe', undefined, open)).status).toBe(200);
  });
});

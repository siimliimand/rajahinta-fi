import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LaunchGateService } from '../feature-flags/launch-gate.service';
import { GATE_ENV_KEYS } from '../feature-flags/launch-gate.types';

describe('LaunchGateService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all launch gate env vars
    delete process.env[GATE_ENV_KEYS.legalOpinion];
    delete process.env[GATE_ENV_KEYS.taxSourceMapping];
    delete process.env[GATE_ENV_KEYS.correctionMechanism];
    delete process.env[GATE_ENV_KEYS.override];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('default state (all gates OFF)', () => {
    it('should have all gates disabled by default', () => {
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(false);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('should disable calculations by default', () => {
      const service = new LaunchGateService();
      expect(service.isCalculationEnabled()).toBe(false);
    });

    it('should hide price data by default', () => {
      const service = new LaunchGateService();
      expect(service.isPriceDataVisible()).toBe(false);
    });
  });

  describe('individual gate overrides', () => {
    it('should enable legal opinion gate via env var', () => {
      process.env[GATE_ENV_KEYS.legalOpinion] = 'true';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(true);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('should enable tax source mapping gate via env var', () => {
      process.env[GATE_ENV_KEYS.taxSourceMapping] = 'true';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(false);
      expect(status.taxSourceMappingConfirmed).toBe(true);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('should enable correction mechanism gate via env var', () => {
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'true';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(false);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(true);
      expect(status.launchReady).toBe(false);
    });

    it('should require ALL gates for launchReady', () => {
      process.env[GATE_ENV_KEYS.legalOpinion] = 'true';
      process.env[GATE_ENV_KEYS.taxSourceMapping] = 'true';
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'true';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(true);
      expect(status.taxSourceMappingConfirmed).toBe(true);
      expect(status.correctionMechanismConfirmed).toBe(true);
      expect(status.launchReady).toBe(true);
    });

    it('should enable calculations only when all gates are confirmed', () => {
      process.env[GATE_ENV_KEYS.legalOpinion] = 'true';
      process.env[GATE_ENV_KEYS.taxSourceMapping] = 'true';
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'true';
      const service = new LaunchGateService();

      expect(service.isCalculationEnabled()).toBe(true);
    });

    it('should show price data only when legal opinion is confirmed', () => {
      process.env[GATE_ENV_KEYS.legalOpinion] = 'true';
      const service = new LaunchGateService();

      expect(service.isPriceDataVisible()).toBe(true);
    });

    it('should not show price data when legal opinion is not confirmed', () => {
      process.env[GATE_ENV_KEYS.taxSourceMapping] = 'true';
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'true';
      const service = new LaunchGateService();

      expect(service.isPriceDataVisible()).toBe(false);
    });
  });

  describe('global override', () => {
    it('should force all gates open with LAUNCH_GATES_OVERRIDE=true', () => {
      process.env[GATE_ENV_KEYS.override] = 'true';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(true);
      expect(status.taxSourceMappingConfirmed).toBe(true);
      expect(status.correctionMechanismConfirmed).toBe(true);
      expect(status.launchReady).toBe(true);
    });

    it('should enable calculations when override is active', () => {
      process.env[GATE_ENV_KEYS.override] = 'true';
      const service = new LaunchGateService();

      expect(service.isCalculationEnabled()).toBe(true);
    });

    it('should enable price data when override is active', () => {
      process.env[GATE_ENV_KEYS.override] = 'true';
      const service = new LaunchGateService();

      expect(service.isPriceDataVisible()).toBe(true);
    });

    it('should ignore individual gate vars when override is active', () => {
      process.env[GATE_ENV_KEYS.override] = 'true';
      process.env[GATE_ENV_KEYS.legalOpinion] = 'false';
      process.env[GATE_ENV_KEYS.taxSourceMapping] = 'false';
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'false';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.launchReady).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should treat non-"true" values as false', () => {
      process.env[GATE_ENV_KEYS.legalOpinion] = 'yes';
      process.env[GATE_ENV_KEYS.taxSourceMapping] = '1';
      process.env[GATE_ENV_KEYS.correctionMechanism] = 'TRUE';
      const service = new LaunchGateService();
      const status = service.getGateStatus();

      expect(status.legalOpinionConfirmed).toBe(false);
      expect(status.taxSourceMappingConfirmed).toBe(false);
      expect(status.correctionMechanismConfirmed).toBe(false);
      expect(status.launchReady).toBe(false);
    });

    it('should return a defensive copy from getGateStatus', () => {
      const service = new LaunchGateService();
      const status1 = service.getGateStatus();
      const status2 = service.getGateStatus();

      expect(status1).not.toBe(status2);
      expect(status1).toEqual(status2);
    });
  });
});

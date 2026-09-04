/**
 * Feature-flag service + guard parity tests (task 3.2) — ported from the
 * FeatureFlagService semantics (packages/application-api/src/feature-flags/
 * feature-flag.service.ts) and the flag-guard deny contract.
 *
 * @module FeatureFlagsTest
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  FeatureFlag,
  FeatureFlagService,
  requireFeatureFlag,
  resolveFlagMap,
  type FeatureFlagConfig,
} from '../feature-flags';
import { respondToError } from '../../errors';
import type { AppEnv } from '../../env';

/** Env with explicit flag vars (undefined keys = unset). */
function envWith(vars: Record<string, string | undefined> = {}): AppEnv['Bindings'] {
  return { ...vars } as unknown as AppEnv['Bindings'];
}

/** Every flag name, boolean map (grows with the FeatureFlag const). */
function allOff(): FeatureFlagConfig {
  return Object.fromEntries(
    Object.values(FeatureFlag).map((flag) => [flag, false]),
  ) as FeatureFlagConfig;
}

/** Same bucket hash as the service — the ported parity constant. */
function bucket(entityId: string): number {
  let hash = 0;
  for (let i = 0; i < entityId.length; i++) {
    hash = (hash * 31 + entityId.charCodeAt(i)) | 0;
  }
  return (hash & 0x7fffffff) % 100;
}

describe('FeatureFlagService', () => {
  it('defaults to all flags disabled', () => {
    const service = new FeatureFlagService(envWith());
    for (const flag of Object.values(FeatureFlag)) {
      expect(service.isEnabled(flag)).toBe(false);
    }
  });

  it('resolves the same flag names as the Nest enum', () => {
    expect(Object.values(FeatureFlag).sort()).toEqual(
      [
        'NEW_MERCHANT_SOURCE',
        'NEW_TAX_RULESET',
        'UI_RANKING_V2',
        'HISTORICAL_PRICE_INTELLIGENCE',
        'BASKET_OPTIMIZATION',
        'ADVANCED_FEATURES',
        'OPERATOR_CONSOLE',
        'UNIT_PRICE_EUR_PER_GRAM',
        'PRICE_ALERTS',
      ].sort(),
    );
  });

  it('enables flags with "true" and "1"', () => {
    const service = new FeatureFlagService(
      envWith({ FF_BASKET_OPTIMIZATION: 'true', FF_UI_RANKING_V2: '1' }),
    );
    expect(service.isEnabled(FeatureFlag.BASKET_OPTIMIZATION)).toBe(true);
    expect(service.isEnabled(FeatureFlag.UI_RANKING_V2)).toBe(true);
    expect(service.isEnabled(FeatureFlag.ADVANCED_FEATURES)).toBe(false);
  });

  it('treats unset and empty values as disabled', () => {
    const service = new FeatureFlagService(
      envWith({ FF_OPERATOR_CONSOLE: undefined, FF_ADVANCED_FEATURES: '' }),
    );
    expect(service.isEnabled(FeatureFlag.OPERATOR_CONSOLE)).toBe(false);
    expect(service.isEnabled(FeatureFlag.ADVANCED_FEATURES)).toBe(false);
  });

  it('treats arbitrary non-numeric strings as disabled', () => {
    const service = new FeatureFlagService(
      envWith({ FF_NEW_TAX_RULESET: 'yes' }),
    );
    expect(service.isEnabled(FeatureFlag.NEW_TAX_RULESET)).toBe(false);
  });

  describe('rollout percentages', () => {
    it('enables a numeric value as a rollout percentage (> 0)', () => {
      const service = new FeatureFlagService(envWith({ FF_UI_RANKING_V2: '50' }));
      // Global isEnabled reflects the boolean (pct > 0).
      expect(service.isEnabled(FeatureFlag.UI_RANKING_V2)).toBe(true);
      // Per-entity resolution buckets deterministically.
      const id = 'entity-abc';
      expect(service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, id)).toBe(
        bucket(id) < 50,
      );
    });

    it('disables with a 0 rollout', () => {
      const service = new FeatureFlagService(envWith({ FF_UI_RANKING_V2: '0' }));
      expect(service.isEnabled(FeatureFlag.UI_RANKING_V2)).toBe(false);
      expect(service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, 'x')).toBe(false);
    });

    it('clamps out-of-range percentages', () => {
      const service = new FeatureFlagService(
        envWith({ FF_UI_RANKING_V2: '500' }),
      );
      // Clamped to 100 → every entity enabled.
      expect(service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, 'any')).toBe(true);
    });

    it('is deterministic per entity ID and covers both sides of a partial rollout', () => {
      const service = new FeatureFlagService(envWith({ FF_UI_RANKING_V2: '50' }));
      const ids = Array.from({ length: 40 }, (_, i) => `entity-${i}`);
      const firstPass = ids.map((id) =>
        service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, id),
      );
      const secondPass = ids.map((id) =>
        service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, id),
      );
      expect(firstPass).toEqual(secondPass);
      // A 50% rollout splits the (hashed) population.
      const enabled = firstPass.filter(Boolean).length;
      expect(enabled).toBeGreaterThan(5);
      expect(enabled).toBeLessThan(35);
    });

    it('honours the FF_ROLLOUT_<FLAG> explicit override', () => {
      // '1' alone means 100% enabled; the rollout var narrows it to 10%.
      const service = new FeatureFlagService(
        envWith({
          FF_UI_RANKING_V2: '1',
          FF_ROLLOUT_UI_RANKING_V2: '10',
        }),
      );
      const id = 'entity-abc';
      expect(service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, id)).toBe(
        bucket(id) < 10,
      );
    });

    it('returns the global value directly when no partial rollout is configured', () => {
      const service = new FeatureFlagService(
        envWith({ FF_UI_RANKING_V2: 'true' }),
      );
      // Enabled, no rollout pct → default 100% → every entity enabled.
      expect(service.isEnabledForEntity(FeatureFlag.UI_RANKING_V2, 'x')).toBe(true);
      // Disabled flag → false regardless of bucket.
      expect(service.isEnabledForEntity(FeatureFlag.NEW_TAX_RULESET, 'x')).toBe(false);
    });
  });

  describe('bootstrap parity map (frontend consumption is 5.x)', () => {
    it('exposes the resolved boolean map — booleans only, no percentages', () => {
      const map = resolveFlagMap(
        envWith({
          FF_BASKET_OPTIMIZATION: 'true',
          FF_UI_RANKING_V2: '35',
        }),
      );
      expect(map).toEqual({ ...allOff(), BASKET_OPTIMIZATION: true, UI_RANKING_V2: true });
      for (const value of Object.values(map)) {
        expect(typeof value).toBe('boolean');
      }
    });

    it('returns a defensive copy from the service', () => {
      const service = new FeatureFlagService(envWith());
      const map1 = service.resolveFlagMap();
      const map2 = service.resolveFlagMap();
      expect(map1).not.toBe(map2);
      expect(map1).toEqual(map2);
    });
  });
});

describe('requireFeatureFlag middleware (FeatureFlagGuard parity)', () => {
  function buildApp(flag: FeatureFlag): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.onError((err, c) => respondToError(c, err));
    app.get('/probe', requireFeatureFlag(flag), (c) => c.json({ ok: true }));
    return app;
  }

  it('denies with the exact message while the flag is off', async () => {
    const res = await buildApp(FeatureFlag.BASKET_OPTIMIZATION).request(
      '/probe',
      undefined,
      envWith(),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { message: string; error: string };
    expect(body.message).toBe('Feature "BASKET_OPTIMIZATION" is not enabled');
    expect(body.error).toBe('Forbidden');
  });

  it('admits when the flag is enabled', async () => {
    const res = await buildApp(FeatureFlag.BASKET_OPTIMIZATION).request(
      '/probe',
      undefined,
      envWith({ FF_BASKET_OPTIMIZATION: 'true' }),
    );
    expect(res.status).toBe(200);
  });

  it('keeps the operator console dark while OPERATOR_CONSOLE is off (default)', async () => {
    const res = await buildApp(FeatureFlag.OPERATOR_CONSOLE).request(
      '/probe',
      undefined,
      envWith(),
    );
    expect(res.status).toBe(403);
  });
});

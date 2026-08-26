/**
 * FeatureFlagsController tests — verifies the public flag-state endpoint
 * the frontend polls to gate UI (task 5.3): every flag's boolean is
 * returned, defaulting to OFF, and enabled flags surface as true without
 * ever exposing rollout percentages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeatureFlagsController } from '../feature-flags/feature-flags.controller';
import { FeatureFlagService } from '../feature-flags/feature-flag.service';
import { FeatureFlag } from '../feature-flags/feature-flag.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FF_VARS = [
  ...Object.values(FeatureFlag).map((f) => `FF_${f}`),
  ...Object.values(FeatureFlag).map((f) => `FF_ROLLOUT_${f}`),
];

beforeEach(() => {
  for (const v of FF_VARS) delete process.env[v];
});

afterEach(() => {
  for (const v of FF_VARS) delete process.env[v];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureFlagsController', () => {
  it('returns every flag defaulting to false (no env overrides)', () => {
    const controller = new FeatureFlagsController(new FeatureFlagService());

    const { flags } = controller.getFlags();

    expect(Object.keys(flags).sort()).toEqual(
      [...Object.values(FeatureFlag)].sort(),
    );
    for (const flag of Object.values(FeatureFlag)) {
      expect(flags[flag]).toBe(false);
    }
  });

  it('surfaces an enabled flag as true (FF_HISTORICAL_PRICE_INTELLIGENCE=true)', () => {
    process.env[`FF_${FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE}`] = 'true';
    const controller = new FeatureFlagsController(new FeatureFlagService());

    const { flags } = controller.getFlags();

    expect(flags[FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE]).toBe(true);
    expect(flags[FeatureFlag.NEW_MERCHANT_SOURCE]).toBe(false);
    expect(flags[FeatureFlag.NEW_TAX_RULESET]).toBe(false);
    expect(flags[FeatureFlag.UI_RANKING_V2]).toBe(false);
  });

  it('exposes booleans only — a partial rollout still reports the global boolean, never a percentage', () => {
    process.env[`FF_${FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE}`] = '25';
    const controller = new FeatureFlagsController(new FeatureFlagService());

    const { flags } = controller.getFlags();

    expect(flags[FeatureFlag.HISTORICAL_PRICE_INTELLIGENCE]).toBe(true);
    // No numeric rollout value leaks into the response shape.
    for (const value of Object.values(flags)) {
      expect(typeof value).toBe('boolean');
    }
  });
});

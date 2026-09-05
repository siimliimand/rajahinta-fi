/**
 * isProducerDupeFinderFlagEnabled tests (task 6.4) — the narrow
 * PRODUCER_DUPE_FINDER lookup's compliance rule: absent key counts as
 * OFF, and only an explicit server-side true reveals the feature
 * (event-calculator-flag.ts precedent).
 *
 * @module ProductDupesFlagTest
 */
import { describe, expect, it } from 'vitest';
import { isProducerDupeFinderFlagEnabled } from './product-dupes-flag';
import type { FeatureFlagsResponse } from '@/lib/types';

function flagsWith(
  producerDupeFinder: boolean | undefined,
): FeatureFlagsResponse {
  return {
    flags: {
      HISTORICAL_PRICE_INTELLIGENCE: false,
      BASKET_OPTIMIZATION: false,
      ADVANCED_FEATURES: false,
      UNIT_PRICE_EUR_PER_GRAM: false,
      ...(producerDupeFinder === undefined
        ? {}
        : { PRODUCER_DUPE_FINDER: producerDupeFinder }),
    },
  };
}

describe('isProducerDupeFinderFlagEnabled', () => {
  it('absent key counts as OFF', () => {
    expect(isProducerDupeFinderFlagEnabled(flagsWith(undefined))).toBe(false);
  });

  it('explicit false is OFF', () => {
    expect(isProducerDupeFinderFlagEnabled(flagsWith(false))).toBe(false);
  });

  it('explicit true is ON', () => {
    expect(isProducerDupeFinderFlagEnabled(flagsWith(true))).toBe(true);
  });
});

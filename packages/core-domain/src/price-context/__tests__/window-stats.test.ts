/**
 * Unit tests for the pure price-context window computation (spec
 * price-context): median/min/max over odd and even bucket counts, delta
 * in cents and basis points, the strictly-above percentile rank in basis
 * points with its isWindowLow fact, the INSUFFICIENT_HISTORY gate at and
 * below the minimum-bucket constant, and the every-number-is-explainable
 * echo of window length, bucket count, and as-of date.
 */
import { describe, expect, it } from 'vitest';

import {
  computePriceContextWindow,
  isPriceContextValue,
  PRICE_CONTEXT_MIN_BUCKETS,
  PRICE_CONTEXT_WINDOW_DAYS,
} from '../window-stats';
import { InvalidPriceContextInputError } from '../price-context.types';

/** Build an ascending bucket series of `n` daily buckets around `base`. */
function series(n: number, base = 1000): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 10);
}

describe('computePriceContextWindow — window statistics', () => {
  it('takes the middle bucket as the median over an odd bucket count', () => {
    // 15 buckets 1000..1140 (shuffled): median is the 8th value, 1070.
    const buckets = [1030, 1140, 1000, 1090, 1120, 1060, 1110, 1070, 1020, 1130, 1050, 1100, 1010, 1080, 1040];
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1070,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.medianCents).toBe(1070);
    expect(result.minCents).toBe(1000);
    expect(result.maxCents).toBe(1140);
    expect(result.bucketCount).toBe(15);
  });

  it('rounds the even-count median down to a whole cent (integer convention, D4)', () => {
    // 14 buckets 1001..1014: middles are 1007 and 1008 → ⌊2015/2⌋ = 1007,
    // not 1007.5 — the median itself never becomes a float.
    const result = computePriceContextWindow({
      bucketsCents: [1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014],
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    // Middles 1007 and 1008 → 1007 (not 1007.5).
    expect(result.medianCents).toBe(1007);
    expect(result.minCents).toBe(1001);
    expect(result.maxCents).toBe(1014);
    expect(result.bucketCount).toBe(14);
  });

  it('sorts an unsorted series internally without mutating the input', () => {
    const buckets = series(PRICE_CONTEXT_MIN_BUCKETS).reverse();
    const snapshot = [...buckets];

    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    expect(buckets).toEqual(snapshot);
    assertComputed(result);
    expect(result.minCents).toBe(1000);
    expect(result.maxCents).toBe(1130);
  });
});

describe('computePriceContextWindow — delta versus median', () => {
  it('computes the delta in cents and basis points above the median', () => {
    const buckets = series(20, 1000); // median 1095 (odd count of 20? no — even)
    // 20 buckets: middles 1090 and 1100 → median 1095.
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1106,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.medianCents).toBe(1095);
    expect(result.deltaVsMedianCents).toBe(11);
    // 11/1095 = 100.456… bps → 100.
    expect(result.deltaVsMedianBasisPoints).toBe(100);
  });

  it('computes a negative delta below the median, symmetric rounding', () => {
    const buckets = series(20, 1000); // median 1095
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1084,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.deltaVsMedianCents).toBe(-11);
    // −11/1095 = −100.456… bps → −100 (half away from zero).
    expect(result.deltaVsMedianBasisPoints).toBe(-100);
  });

  it('rounds non-integer basis-point ratios half away from zero', () => {
    // Median 300 via crafted series of 15 buckets; delta 1 → 33.33… → 33 bps.
    const buckets = Array.from({ length: 15 }, (_, i) => (i < 7 ? 299 : i === 7 ? 300 : 301));
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 301,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.medianCents).toBe(300);
    expect(result.deltaVsMedianCents).toBe(1);
    expect(result.deltaVsMedianBasisPoints).toBe(33);
  });
});

describe('computePriceContextWindow — percentile rank and window low', () => {
  it('saturates at 10000 basis points when the current best is below every bucket', () => {
    // 15 buckets 1000..1140, current 990: all 15 sit strictly above
    // → 15/15 × 10000 = 10000. Not the window low — below it.
    const result = computePriceContextWindow({
      bucketsCents: series(15),
      currentBestCents: 990,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.percentileRankBasisPoints).toBe(10000);
    expect(result.isWindowLow).toBe(false);
  });

  it('is zero at the window maximum — no bucket sits strictly above', () => {
    // 14 buckets 1000..1130, current = max: 0/14 × 10000 = 0, ties or not.
    const result = computePriceContextWindow({
      bucketsCents: series(14),
      currentBestCents: 1130,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.percentileRankBasisPoints).toBe(0);
    expect(result.isWindowLow).toBe(false);
  });

  it('excludes ties from the strictly-above count and rounds the non-integer ratio down', () => {
    // Four 500s, six 1000s, four 2000s; current 1000 — the six ties are
    // not above it, so 4/14 = 2857.14… → 2857 bps. Not the window low.
    const buckets = [500, 500, 500, 500, 1000, 1000, 1000, 1000, 1000, 1000, 2000, 2000, 2000, 2000];
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.percentileRankBasisPoints).toBe(2857);
    expect(result.isWindowLow).toBe(false);
  });

  it('rounds an exact half-basis-point ratio away from zero', () => {
    // One 2000 among thirty-one 1000s; current 1000 — the tie does not
    // count, so 1/32 = 312.5 bps → 313 (half away from zero). The
    // current best equals the window minimum → isWindowLow.
    const buckets = [...Array.from({ length: 31 }, () => 1000), 2000];
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.percentileRankBasisPoints).toBe(313);
    expect(result.isWindowLow).toBe(true);
  });

  it('rounds a sub-half ratio down — a third of the window above', () => {
    // Twenty 1000s (ties) and ten 2000s; current 1000 → 10/30
    // = 3333.33… → 3333 bps (0.33 rounds down). Window low: true.
    const buckets = [...Array.from({ length: 20 }, () => 1000), ...Array.from({ length: 10 }, () => 2000)];
    const result = computePriceContextWindow({
      bucketsCents: buckets,
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.percentileRankBasisPoints).toBe(3333);
    expect(result.isWindowLow).toBe(true);
  });
});

describe('computePriceContextWindow — explainability echo (D5)', () => {
  it('travels window length, bucket count, and as-of on the value branch', () => {
    const result = computePriceContextWindow({
      bucketsCents: series(30),
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    assertComputed(result);
    expect(result.windowDays).toBe(PRICE_CONTEXT_WINDOW_DAYS);
    expect(result.bucketCount).toBe(30);
    expect(result.asOf).toBe('2026-09-08');
  });
});

describe('computePriceContextWindow — insufficient history gate (D5)', () => {
  it(`is unavailable below ${PRICE_CONTEXT_MIN_BUCKETS} buckets with nulls and the reason`, () => {
    const result = computePriceContextWindow({
      bucketsCents: series(PRICE_CONTEXT_MIN_BUCKETS - 1),
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    expect(result).toEqual({
      status: 'unavailable',
      medianCents: null,
      minCents: null,
      maxCents: null,
      deltaVsMedianCents: null,
      deltaVsMedianBasisPoints: null,
      percentileRankBasisPoints: null,
      isWindowLow: null,
      reason: 'INSUFFICIENT_HISTORY',
      windowDays: PRICE_CONTEXT_WINDOW_DAYS,
      bucketCount: PRICE_CONTEXT_MIN_BUCKETS - 1,
      asOf: '2026-09-08',
    });
  });

  it(`is computed at exactly ${PRICE_CONTEXT_MIN_BUCKETS} buckets (boundary)`, () => {
    const result = computePriceContextWindow({
      bucketsCents: series(PRICE_CONTEXT_MIN_BUCKETS),
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    expect(isPriceContextValue(result)).toBe(true);
    if (isPriceContextValue(result)) {
      expect(result.bucketCount).toBe(PRICE_CONTEXT_MIN_BUCKETS);
      expect(result.medianCents).toBeGreaterThan(0);
    }
  });

  it('treats an empty series as insufficient history, not an error', () => {
    const result = computePriceContextWindow({
      bucketsCents: [],
      currentBestCents: 1000,
      asOf: '2026-09-08',
    });

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('INSUFFICIENT_HISTORY');
      expect(result.bucketCount).toBe(0);
    }
  });

  it('gates before validating values — a thin window is honest regardless of content', () => {
    const result = computePriceContextWindow({
      bucketsCents: [0, -5, 10.5],
      currentBestCents: Number.NaN,
      asOf: '',
    });

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('INSUFFICIENT_HISTORY');
    }
  });
});

describe('computePriceContextWindow — invalid input contract', () => {
  const validBuckets = series(PRICE_CONTEXT_MIN_BUCKETS);

  it('throws on a non-integer, non-positive, or non-finite current price', () => {
    for (const currentBestCents of [1000.5, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        computePriceContextWindow({
          bucketsCents: validBuckets,
          currentBestCents,
          asOf: '2026-09-08',
        }),
      ).toThrow(InvalidPriceContextInputError);
    }
  });

  it('throws on a non-integer, non-positive, or non-finite bucket', () => {
    for (const bad of [1000.5, 0, -1, Number.NaN]) {
      expect(() =>
        computePriceContextWindow({
          bucketsCents: [...validBuckets.slice(0, -1), bad],
          currentBestCents: 1000,
          asOf: '2026-09-08',
        }),
      ).toThrow(InvalidPriceContextInputError);
    }
  });

  it('throws on an empty as-of date', () => {
    expect(() =>
      computePriceContextWindow({
        bucketsCents: validBuckets,
        currentBestCents: 1000,
        asOf: '',
      }),
    ).toThrow(InvalidPriceContextInputError);
  });
});

/** Narrow to the value branch or fail the test with the actual status. */
function assertComputed(
  result: ReturnType<typeof computePriceContextWindow>,
): asserts result is Extract<
  ReturnType<typeof computePriceContextWindow>,
  { status: 'computed' }
> {
  if (result.status !== 'computed') {
    throw new Error(`expected computed, got ${result.status} (${result.reason})`);
  }
}

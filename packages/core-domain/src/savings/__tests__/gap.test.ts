/**
 * Unit tests for the pure savings-gap computation (spec savings-discovery).
 *
 * Pins: happy-path cents + basis points, integer basis-point rounding
 * (half away from zero, negative gaps included), explicit unavailable
 * reasons in policy order, and identity echo on both branches.
 */
import { describe, expect, it } from 'vitest';

import { computeSavingsGap, isSavingsGapValue } from '../gap';

describe('computeSavingsGap — happy path', () => {
  it('computes the gap in cents and basis points for a landed cost above the reference', () => {
    const result = computeSavingsGap({
      productId: 7,
      productName: 'Koskenkorva 60% 0.5 l',
      landedTotalCents: 2500,
      alkoReferenceCents: 2000,
    });

    expect(result).toEqual({
      status: 'computed',
      productId: 7,
      productName: 'Koskenkorva 60% 0.5 l',
      landedTotalCents: 2500,
      alkoReferenceCents: 2000,
      gapCents: 500,
      gapBasisPoints: 2500,
    });
  });

  it('keeps negative gaps for a landed cost below the reference (import cheaper)', () => {
    const result = computeSavingsGap({
      productId: 7,
      productName: 'Koskenkorva 60% 0.5 l',
      landedTotalCents: 1800,
      alkoReferenceCents: 2000,
    });

    assertComputed(result);
    expect(result.gapCents).toBe(-200);
    expect(result.gapBasisPoints).toBe(-1000);
  });

  it('yields zero gap when the landed total equals the reference', () => {
    const result = computeSavingsGap({
      productId: 1,
      productName: 'Same price',
      landedTotalCents: 1999,
      alkoReferenceCents: 1999,
    });

    assertComputed(result);
    expect(result.gapCents).toBe(0);
    expect(result.gapBasisPoints).toBe(0);
  });
});

describe('computeSavingsGap — integer basis-point math (D4)', () => {
  it('rounds non-integer ratios half away from zero', () => {
    // 1/3 = 3333.33… bps → 3333; 2/3 = 6666.67… bps → 6667.
    const third = computeSavingsGap({
      productId: 1,
      productName: 'a',
      landedTotalCents: 4,
      alkoReferenceCents: 3,
    });
    const twoThirds = computeSavingsGap({
      productId: 2,
      productName: 'b',
      landedTotalCents: 5,
      alkoReferenceCents: 3,
    });

    assertComputed(third);
    assertComputed(twoThirds);
    expect(third.gapBasisPoints).toBe(3333);
    expect(twoThirds.gapBasisPoints).toBe(6667);
  });

  it('rounds negative ratios half away from zero (symmetric with positive)', () => {
    // −1/3 = −3333.33… bps → −3333; −2/3 = −6666.67… bps → −6667.
    const minusThird = computeSavingsGap({
      productId: 1,
      productName: 'a',
      landedTotalCents: 2,
      alkoReferenceCents: 3,
    });
    const minusTwoThirds = computeSavingsGap({
      productId: 2,
      productName: 'b',
      landedTotalCents: 1,
      alkoReferenceCents: 3,
    });

    assertComputed(minusThird);
    assertComputed(minusTwoThirds);
    expect(minusThird.gapBasisPoints).toBe(-3333);
    expect(minusTwoThirds.gapBasisPoints).toBe(-6667);
  });

  it('stays exact on large figures (no float distortion)', () => {
    const result = computeSavingsGap({
      productId: 1,
      productName: 'a',
      landedTotalCents: 987_654,
      alkoReferenceCents: 123_457,
    });

    assertComputed(result);
    // 864197 / 123457 = 7.0000121… → 70000.121… bps → 70000.
    expect(result.gapCents).toBe(864_197);
    expect(result.gapBasisPoints).toBe(70_000);
  });
});

describe('computeSavingsGap — unavailable reasons', () => {
  const base = {
    productId: 42,
    productName: 'Product',
  } as const;

  it('reports MISSING_LANDED_TOTAL when no landed total exists', () => {
    for (const landedTotalCents of [null, undefined]) {
      const result = computeSavingsGap({
        ...base,
        landedTotalCents,
        alkoReferenceCents: 2000,
      });

      expect(result).toEqual({
        status: 'unavailable',
        productId: 42,
        productName: 'Product',
        landedTotalCents: null,
        alkoReferenceCents: null,
        gapCents: null,
        gapBasisPoints: null,
        reason: 'MISSING_LANDED_TOTAL',
      });
    }
  });

  it('reports MISSING_ALKO_REFERENCE when no reference offer qualifies', () => {
    for (const alkoReferenceCents of [null, undefined]) {
      const result = computeSavingsGap({
        ...base,
        landedTotalCents: 2500,
        alkoReferenceCents,
      });

      expect(result).toEqual({
        status: 'unavailable',
        productId: 42,
        productName: 'Product',
        landedTotalCents: null,
        alkoReferenceCents: null,
        gapCents: null,
        gapBasisPoints: null,
        reason: 'MISSING_ALKO_REFERENCE',
      });
    }
  });

  it('reports INVALID_LANDED_TOTAL for non-integer or negative landed totals', () => {
    for (const landedTotalCents of [Number.NaN, 2500.5, -1, Number.POSITIVE_INFINITY]) {
      const result = computeSavingsGap({
        ...base,
        landedTotalCents,
        alkoReferenceCents: 2000,
      });
      expect(
        result.status === 'unavailable' ? result.reason : result.status,
      ).toBe('INVALID_LANDED_TOTAL');
    }
  });

  it('reports INVALID_ALKO_REFERENCE for non-integer or non-positive references', () => {
    for (const alkoReferenceCents of [Number.NaN, 2000.5, 0, -2000]) {
      const result = computeSavingsGap({
        ...base,
        landedTotalCents: 2500,
        alkoReferenceCents,
      });
      expect(
        result.status === 'unavailable' ? result.reason : result.status,
      ).toBe('INVALID_ALKO_REFERENCE');
    }
  });

  it('reports missing inputs before invalid ones (known unknowns first)', () => {
    const result = computeSavingsGap({
      ...base,
      landedTotalCents: null,
      alkoReferenceCents: Number.NaN,
    });

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('MISSING_LANDED_TOTAL');
    }
  });
});

describe('isSavingsGapValue', () => {
  it('narrows the union so the listing can omit unavailable rows', () => {
    const value = computeSavingsGap({
      productId: 1,
      productName: 'a',
      landedTotalCents: 2500,
      alkoReferenceCents: 2000,
    });
    const unavailable = computeSavingsGap({
      productId: 2,
      productName: 'b',
      landedTotalCents: null,
      alkoReferenceCents: 2000,
    });

    expect(isSavingsGapValue(value)).toBe(true);
    expect(isSavingsGapValue(unavailable)).toBe(false);
  });
});

/** Narrow to the value branch or fail the test with the actual status. */
function assertComputed(
  result: ReturnType<typeof computeSavingsGap>,
): asserts result is Extract<ReturnType<typeof computeSavingsGap>, { status: 'computed' }> {
  if (result.status !== 'computed') {
    throw new Error(`expected computed, got ${result.status} (${result.reason})`);
  }
}

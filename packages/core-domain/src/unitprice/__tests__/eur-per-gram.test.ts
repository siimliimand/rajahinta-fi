/**
 * Tests for the pure unit-price metric (cents per gram of ethanol).
 *
 * High-liability numeric contract: the density conversion (789 g/l) and
 * the status model (computed / ESTIMATED / unavailable) are spec-fixed,
 * so the vectors below assert exact expected decimals computed by hand.
 * Pure functions — no DB, no mocks.
 *
 * @module EurPerGramTests
 */
import { describe, it, expect } from 'vitest';
import { eurPerGram, ETHANOL_DENSITY_G_PER_L } from '../eur-per-gram';
import type { UnitPriceValue } from '../unitprice.types';

describe('ETHANOL_DENSITY_G_PER_L', () => {
  // Pins the spec value: changing it silently re-ranks every offer.
  it('is exactly 789 g/l', () => {
    expect(ETHANOL_DENSITY_G_PER_L).toBe(789);
  });
});

describe('eurPerGram — numeric vectors (density conversion included)', () => {
  it('spirits: 2000 c, 0.5 l, 40% → 0.5 × 0.40 × 789 = 157.8 g → 2000/157.8 c/g', () => {
    const result = assertValue(eurPerGram(2000, 0.5, 0.4), 'computed');
    expect(result.ethanolGrams).toBeCloseTo(157.8, 9);
    // 10000/789 = 12.6742712294…
    expect(result.centsPerGram).toBeCloseTo(12.6742712294, 10);
  });

  it('exact arithmetic: 789 c, 1 l, 100% → 789 g → exactly 1 c/g', () => {
    const result = assertValue(eurPerGram(789, 1, 1), 'computed');
    expect(result.ethanolGrams).toBe(789);
    expect(result.centsPerGram).toBe(1);
  });

  it('wine: 1500 c, 0.75 l, 12% → 0.75 × 0.12 × 789 = 71.01 g → 1500/71.01 c/g', () => {
    const result = assertValue(eurPerGram(1500, 0.75, 0.12), 'computed');
    expect(result.ethanolGrams).toBeCloseTo(71.01, 9);
    expect(result.centsPerGram).toBeCloseTo(21.1237853823, 10);
  });

  it('beer: 300 c, 0.33 l, 4.7% → 0.33 × 0.047 × 789 = 12.23739 g → 300/12.23739 c/g', () => {
    const result = assertValue(eurPerGram(300, 0.33, 0.047), 'computed');
    expect(result.ethanolGrams).toBeCloseTo(12.23739, 9);
    expect(result.centsPerGram).toBeCloseTo(24.5150313915, 9);
  });

  it('round-trips: centsPerGram × ethanolGrams recovers the offer price', () => {
    const result = assertValue(eurPerGram(2000, 0.5, 0.4), 'computed');
    expect(result.centsPerGram * result.ethanolGrams).toBeCloseTo(2000, 6);
  });

  it('scales linearly with price only — same bottle, half price, half c/g', () => {
    const full = assertValue(eurPerGram(2000, 0.5, 0.4), 'computed');
    const half = assertValue(eurPerGram(1000, 0.5, 0.4), 'computed');
    expect(half.centsPerGram).toBeCloseTo(full.centsPerGram / 2, 12);
  });
});

describe('eurPerGram — status model', () => {
  const price = { cents: 2000, volume: 0.5, abv: 0.4 };

  it('defaults to VERIFIED when the reliability argument is omitted', () => {
    const result = assertValue(eurPerGram(price.cents, price.volume, price.abv), 'computed');
    expect(result.priceReliability).toBe('VERIFIED');
  });

  it('explicit VERIFIED → computed', () => {
    const result = assertValue(
      eurPerGram(price.cents, price.volume, price.abv, 'VERIFIED'),
      'computed',
    );
    expect(result.priceReliability).toBe('VERIFIED');
  });

  it.each(['STALE', 'ESTIMATED', 'UNAVAILABLE'] as const)(
    'price %s → status ESTIMATED, value still returned unchanged',
    (reliability) => {
      const verified = assertValue(
        eurPerGram(price.cents, price.volume, price.abv, 'VERIFIED'),
        'computed',
      );
      const result = assertValue(
        eurPerGram(price.cents, price.volume, price.abv, reliability),
        'ESTIMATED',
      );
      expect(result.priceReliability).toBe(reliability);
      expect(result.centsPerGram).toBe(verified.centsPerGram);
      expect(result.ethanolGrams).toBe(verified.ethanolGrams);
    },
  );
});

describe('eurPerGram — unavailable (explicit, no substituted value)', () => {
  it('missing volume → MISSING_VOLUME with null values', () => {
    expect(eurPerGram(2000, null, 0.4)).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_VOLUME',
    });
  });

  it('missing alcohol fraction → MISSING_ALCOHOL_FRACTION', () => {
    const result = eurPerGram(2000, 0.5, undefined);
    expect(result).toMatchObject({ status: 'unavailable', reason: 'MISSING_ALCOHOL_FRACTION' });
    expect(result.centsPerGram).toBeNull();
  });

  it('volume ≤ 0 or non-finite → INVALID_VOLUME', () => {
    for (const bad of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(eurPerGram(2000, bad, 0.4)).toMatchObject({
        status: 'unavailable',
        reason: 'INVALID_VOLUME',
      });
    }
  });

  it('alcohol fraction ≤ 0, > 1 (percent passed as fraction), or non-finite → INVALID_ALCOHOL_FRACTION', () => {
    for (const bad of [0, -0.04, 40, 1.01, Number.NaN]) {
      expect(eurPerGram(2000, 0.5, bad)).toMatchObject({
        status: 'unavailable',
        reason: 'INVALID_ALCOHOL_FRACTION',
      });
    }
  });

  it('fraction of exactly 1 (pure ethanol) is valid', () => {
    const result = assertValue(eurPerGram(789, 1, 1), 'computed');
    expect(result.centsPerGram).toBe(1);
  });

  it('negative or non-finite price → INVALID_PRICE', () => {
    for (const bad of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(eurPerGram(bad, 0.5, 0.4)).toMatchObject({
        status: 'unavailable',
        reason: 'INVALID_PRICE',
      });
    }
  });

  it('a zero price is structurally valid → 0 cents per gram', () => {
    const result = assertValue(eurPerGram(0, 0.5, 0.4), 'computed');
    expect(result.centsPerGram).toBe(0);
  });

  it('missing inputs are reported before invalid ones (documented precedence)', () => {
    // Missing volume + invalid price: the missing-data reason wins.
    expect(eurPerGram(-5, null, 0.4)).toMatchObject({ reason: 'MISSING_VOLUME' });
    // Missing abv + invalid volume: missing-alcohol check still comes first.
    expect(eurPerGram(-5, 0, undefined)).toMatchObject({ reason: 'MISSING_ALCOHOL_FRACTION' });
  });
});

/** Narrow a result to the value branch, asserting the expected status. */
function assertValue(
  result: ReturnType<typeof eurPerGram>,
  status: 'computed' | 'ESTIMATED',
): UnitPriceValue {
  expect(result.status).toBe(status);
  if (result.status === 'unavailable') {
    throw new Error(`expected a value, got unavailable: ${result.reason}`);
  }
  return result;
}

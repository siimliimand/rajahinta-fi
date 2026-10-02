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

  it('alcohol fraction < 0, > 1 (percent passed as fraction), or non-finite → INVALID_ALCOHOL_FRACTION', () => {
    for (const bad of [-0.04, 40, 1.01, Number.NaN]) {
      expect(eurPerGram(2000, 0.5, bad)).toMatchObject({
        status: 'unavailable',
        reason: 'INVALID_ALCOHOL_FRACTION',
      });
    }
  });

  it('ABV exactly 0 → ZERO_ETHANOL, not INVALID_ALCOHOL_FRACTION (live case: Karhu 0,0)', () => {
    // Data is present and valid; the metric is physically undefined
    // (denominator zero), which is a different honesty claim than
    // "the record is broken".
    expect(eurPerGram(2000, 0.33, 0)).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'ZERO_ETHANOL',
    });
  });

  it('a 0 fraction never yields a value, for any price', () => {
    for (const cents of [0, 2000, -1]) {
      const result = eurPerGram(cents, 0.33, 0);
      expect(result.status).toBe('unavailable');
      expect(result.centsPerGram).toBeNull();
      expect(result.ethanolGrams).toBeNull();
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

  it('zero-ethanol sits between known unknowns and value-level faults (documented precedence)', () => {
    // Known unknowns still win: missing abv + zero abv elsewhere aside,
    // a missing fraction beats the zero check; invalid volume beats it too.
    expect(eurPerGram(-5, 0.5, undefined)).toMatchObject({
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
    expect(eurPerGram(2000, 0, 0)).toMatchObject({ reason: 'INVALID_VOLUME' });
    // Zero ethanol is reported before later faults (invalid price,
    // invalid fraction cannot mask it).
    expect(eurPerGram(-5, 0.33, 0)).toMatchObject({ reason: 'ZERO_ETHANOL' });
  });
});

describe('eurPerGram — missing price (task 2.2, change honest-trust-surfaces)', () => {
  it('null price with complete physicals → MISSING_PRICE, not INVALID_PRICE', () => {
    // A listing with no current-available offer has no price INPUT —
    // genuinely absent, a different honesty claim than a supplied-but-
    // unusable price (INVALID_PRICE stays reserved for value faults).
    expect(eurPerGram(null, 0.33, 0.047)).toEqual({
      status: 'unavailable',
      centsPerGram: null,
      ethanolGrams: null,
      reason: 'MISSING_PRICE',
    });
    expect(eurPerGram(undefined, 0.33, 0.047)).toMatchObject({
      reason: 'MISSING_PRICE',
    });
  });

  it('missing price is a known unknown — reported before value-level faults', () => {
    expect(eurPerGram(null, 0, 0.4)).toMatchObject({ reason: 'MISSING_PRICE' });
    expect(eurPerGram(null, 0.33, 0)).toMatchObject({ reason: 'MISSING_PRICE' });
    expect(eurPerGram(null, 0.5, 40)).toMatchObject({ reason: 'MISSING_PRICE' });
  });

  it('the other known unknowns still outrank the missing price (module precedence)', () => {
    expect(eurPerGram(null, null, 0.4)).toMatchObject({ reason: 'MISSING_VOLUME' });
    expect(eurPerGram(null, 0.5, undefined)).toMatchObject({
      reason: 'MISSING_ALCOHOL_FRACTION',
    });
  });
});

describe('eurPerGram — units per package (task 6.1 amendment, honest-trust-surfaces)', () => {
  it('scales the denominator: 2000 c, 0.5 l, 40%, 24 units → 3787.2 g → 0.528 ¢/g', () => {
    // A 24-pack priced as one line: the denominator is the package
    // total (0.5 × 24 = 12 l), so numerator and denominator describe
    // the same physical goods.
    const result = assertValue(eurPerGram(2000, 0.5, 0.4, 'VERIFIED', 24), 'computed');
    expect(result.ethanolGrams).toBeCloseTo(3787.2, 9);
    expect(result.centsPerGram).toBeCloseTo(0.5280946346, 9);
  });

  it('live 2900 shape: 2199 c, 0.33 l, 5.3%, 24 units → 331.19 g → ≈ 6.64 ¢/g (was 159.35)', () => {
    // The live defect priced the pack (2199 ¢) against ONE can's volume
    // (0.33 l → 159.35 ¢/g, beer priced like gold). The package
    // denominator gives the honest figure.
    const result = assertValue(eurPerGram(2199, 0.33, 0.053, 'VERIFIED', 24), 'computed');
    expect(result.ethanolGrams).toBeCloseTo(331.19064, 9);
    expect(result.centsPerGram).toBeCloseTo(6.6396803968, 9);
    // Sane beer band at pack granularity, unlike the corrupted 159.35.
    expect(result.centsPerGram).toBeGreaterThan(4);
    expect(result.centsPerGram).toBeLessThan(12);
  });

  it('status model is untouched: non-VERIFIED price with units → ESTIMATED', () => {
    const result = assertValue(eurPerGram(2199, 0.33, 0.053, 'STALE', 24), 'ESTIMATED');
    expect(result.priceReliability).toBe('STALE');
    expect(result.centsPerGram).toBeCloseTo(6.6396803968, 9);
  });

  it('omitted units is byte-identical to explicit undefined, for every status', () => {
    // The default-1 contract: existing callers' results cannot move.
    const vectors = [
      [2000, 0.5, 0.4, 'VERIFIED'],
      [2199, 0.33, 0.053, 'VERIFIED'],
      [300, 0.33, 0.047, 'ESTIMATED'],
      [null, 0.33, 0.047, 'VERIFIED'],
      [2000, null, 0.4, 'VERIFIED'],
      [2000, 0.33, null, 'VERIFIED'],
      [2000, 0, 0.4, 'VERIFIED'],
      [2000, 0.33, 0, 'VERIFIED'],
      [2000, 0.33, 40, 'VERIFIED'],
      [-5, 0.5, 0.4, 'VERIFIED'],
    ] as const;
    for (const [price, volume, abv, reliability] of vectors) {
      expect(JSON.stringify(eurPerGram(price, volume, abv, reliability))).toBe(
        JSON.stringify(eurPerGram(price, volume, abv, reliability, undefined)),
      );
    }
  });

  it('explicit units of 1 is byte-identical to the omitted-argument result', () => {
    // A parsed "1×0,33 l"-style name resolves to one unit — the same
    // bytes the single-unit formula always produced.
    const omitted = eurPerGram(300, 0.33, 0.047);
    expect(JSON.stringify(eurPerGram(300, 0.33, 0.047, 'VERIFIED', 1))).toBe(
      JSON.stringify(omitted),
    );
    expect(JSON.stringify(eurPerGram(300, 0.33, 0.047, 'ESTIMATED', 1))).toBe(
      JSON.stringify(eurPerGram(300, 0.33, 0.047, 'ESTIMATED')),
    );
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'provided units %s is not finite ≥ 1 → INVALID_UNITS_PER_PACKAGE',
    (bad) => {
      expect(eurPerGram(2199, 0.33, 0.053, 'VERIFIED', bad)).toEqual({
        status: 'unavailable',
        centsPerGram: null,
        ethanolGrams: null,
        reason: 'INVALID_UNITS_PER_PACKAGE',
      });
    },
  );

  it('null is a supplied non-value → INVALID_UNITS_PER_PACKAGE (only undefined defaults to 1)', () => {
    expect(eurPerGram(2199, 0.33, 0.053, 'VERIFIED', null)).toMatchObject({
      status: 'unavailable',
      reason: 'INVALID_UNITS_PER_PACKAGE',
    });
  });

  it('precedence: units validates after the volume it scales and before the later faults', () => {
    // Invalid volume still wins (earlier phase).
    expect(eurPerGram(2000, 0, 0.4, 'VERIFIED', 0)).toMatchObject({
      reason: 'INVALID_VOLUME',
    });
    // Invalid units beat zero ethanol, invalid fraction, invalid price.
    expect(eurPerGram(2000, 0.33, 0, 'VERIFIED', -1)).toMatchObject({
      reason: 'INVALID_UNITS_PER_PACKAGE',
    });
    expect(eurPerGram(2000, 0.33, 40, 'VERIFIED', Number.NaN)).toMatchObject({
      reason: 'INVALID_UNITS_PER_PACKAGE',
    });
    expect(eurPerGram(-5, 0.33, 0.4, 'VERIFIED', Number.NaN)).toMatchObject({
      reason: 'INVALID_UNITS_PER_PACKAGE',
    });
    // Known unknowns still outrank everything: missing price + bad units.
    expect(eurPerGram(null, 0.33, 0.4, 'VERIFIED', 0)).toMatchObject({
      reason: 'MISSING_PRICE',
    });
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

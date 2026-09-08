/**
 * Tests for the pure €/g ranking policy.
 *
 * High-liability ordering contract: the ranked order and the omission
 * policy are spec-fixed (unit-price-metrics — deterministic order,
 * VERIFIED/ESTIMATED rows only, unavailable omitted), so the vectors
 * below pin the exact order, the tie-break chain, and which candidates
 * drop. Metrics come from the real `eurPerGram` — the policy is tested
 * against the module it must never re-implement. Pure — no DB, no mocks.
 *
 * @module UnitPriceRankingTests
 */
import { describe, it, expect } from 'vitest';
import { rankUnitPrices } from '../ranking';
import type { UnitPriceRankingEntry } from '../ranking';
import { eurPerGram } from '../eur-per-gram';

/** Entry builder — the metric is always computed by the real module. */
function entry(
  productId: number,
  offerId: number,
  priceCents: number,
  priceReliability?: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE',
  volumeL: number | null = 1,
  alcoholFraction: number | null = 1,
): UnitPriceRankingEntry {
  return {
    productId,
    offerId,
    metric: eurPerGram(priceCents, volumeL, alcoholFraction, priceReliability),
  };
}

describe('rankUnitPrices — ordering', () => {
  it('orders by €/g ascending (hand-computed vectors)', () => {
    // 789 c / 789 g = 1 c/g; 1578 c / 789 g = 2 c/g; 2367 c / 789 g = 3 c/g.
    const rows = rankUnitPrices([
      entry(3, 31, 2367),
      entry(1, 11, 789),
      entry(2, 21, 1578),
    ]);
    expect(rows.map((r) => r.productId)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.centsPerGram)).toEqual([1, 2, 3]);
  });

  it('is deterministic: any input permutation yields the identical order', () => {
    const input = [
      entry(5, 51, 2367),
      entry(1, 11, 789),
      entry(4, 41, 1578),
      entry(2, 21, 789),
    ];
    const first = rankUnitPrices(input);
    const reversed = rankUnitPrices([...input].reverse());
    const shuffled = rankUnitPrices([input[2]!, input[0]!, input[3]!, input[1]!]);
    expect(reversed).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it('resolves an exact value tie by product id ascending', () => {
    // Both products compute exactly 1 c/g (789 c / 789 g).
    const rows = rankUnitPrices([
      entry(7, 71, 789),
      entry(2, 21, 789),
      entry(5, 51, 789),
    ]);
    expect(rows.map((r) => r.productId)).toEqual([2, 5, 7]);
  });

  it('interleaves ties with distinct values correctly (value first, then id)', () => {
    const rows = rankUnitPrices([
      entry(9, 91, 1578), // 2 c/g
      entry(3, 31, 789), // 1 c/g — ties with id 1
      entry(1, 11, 789), // 1 c/g
    ]);
    expect(rows.map((r) => r.productId)).toEqual([1, 3, 9]);
  });
});

describe('rankUnitPrices — omission', () => {
  it('omits unavailable metrics (missing volume, missing ABV, invalid price)', () => {
    const rows = rankUnitPrices([
      entry(1, 11, 300, 'VERIFIED', null, 0.047), // MISSING_VOLUME
      entry(2, 21, 300, 'VERIFIED', 0.33, null), // MISSING_ALCOHOL_FRACTION
      entry(3, 31, -5, 'VERIFIED'), // INVALID_PRICE
      entry(4, 41, 300), // rankable — stays
    ]);
    expect(rows.map((r) => r.productId)).toEqual([4]);
  });

  it('omits STALE and UNAVAILABLE price provenance even though eurPerGram returns a value', () => {
    const rows = rankUnitPrices([
      entry(1, 11, 300, 'STALE'),
      entry(2, 21, 300, 'UNAVAILABLE'),
      entry(3, 31, 300, 'VERIFIED'),
      entry(4, 41, 400, 'ESTIMATED'),
    ]);
    // A stale/unavailable price must not masquerade as an ESTIMATED row.
    expect(rows.map((r) => r.productId)).toEqual([3, 4]);
    expect(rows.map((r) => r.reliabilityStatus)).toEqual(['VERIFIED', 'ESTIMATED']);
  });

  it('returns an empty list when no candidate is rankable', () => {
    expect(rankUnitPrices([entry(1, 11, 300, 'STALE')])).toEqual([]);
    expect(rankUnitPrices([])).toEqual([]);
  });
});

describe('rankUnitPrices — best offer per product', () => {
  it('represents a product once, by its cheapest rankable offer', () => {
    const rows = rankUnitPrices([
      entry(1, 12, 1578), // 2 c/g
      entry(1, 11, 789), // 1 c/g — cheapest
      entry(1, 13, 2367), // 3 c/g
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.offerId).toBe(11);
    expect(rows[0]!.centsPerGram).toBe(1);
  });

  it('never lets an excluded (STALE) offer win, even when cheaper', () => {
    const rows = rankUnitPrices([
      entry(1, 11, 100, 'STALE'), // cheaper — but not rankable
      entry(1, 12, 789, 'VERIFIED'),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.offerId).toBe(12);
  });

  it('resolves an intra-product value tie by the lowest offer id', () => {
    const rows = rankUnitPrices([
      entry(1, 17, 789),
      entry(1, 3, 789),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.offerId).toBe(3);
  });
});

describe('rankUnitPrices — status carriage', () => {
  it('carries VERIFIED for computed metrics and ESTIMATED for estimated ones', () => {
    const rows = rankUnitPrices([
      entry(1, 11, 300, 'VERIFIED', 0.33, 0.047),
      entry(2, 21, 350, 'ESTIMATED', 0.33, 0.047),
    ]);
    expect(rows.map((r) => r.reliabilityStatus)).toEqual(['VERIFIED', 'ESTIMATED']);
  });

  it('carries the metric value and denominator evidence unchanged', () => {
    // 0.33 l × 0.047 × 789 = 12.23739 g; 300 / 12.23739 c/g.
    const rows = rankUnitPrices([entry(1, 11, 300, 'VERIFIED', 0.33, 0.047)]);
    expect(rows[0]!.ethanolGrams).toBeCloseTo(12.23739, 9);
    expect(rows[0]!.centsPerGram).toBeCloseTo(24.5150313915, 9);
    expect(rows[0]!.productId).toBe(1);
    expect(rows[0]!.offerId).toBe(11);
  });
});

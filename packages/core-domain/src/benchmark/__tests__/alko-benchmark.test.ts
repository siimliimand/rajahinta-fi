/**
 * Alko benchmark tests.
 *
 * Display-only enrichment coverage with exact numeric vectors:
 *   - difference math and the percentage rounding rule (half away from
 *     zero at ALKO_BENCHMARK_PERCENT_DECIMALS) pinned value by value,
 *     including the negative half cases
 *   - deterministic reference selection: most recent observedAt, tie
 *     broken by higher offer id, order-independent, full-tie stable
 *   - fail-closed validation: every invalid input degrades to an
 *     explicit unavailable result with a reason and null values —
 *     nothing is ever substituted or partially trusted
 *   - absence as a normal state (empty reference list)
 *   - purity: input never mutated, repeated calls identical, no fields
 *     beyond the documented surface
 *
 * @module AlkoBenchmarkTest
 */

import { describe, it, expect } from 'vitest';
import {
  computeAlkoBenchmark,
  ALKO_BENCHMARK_PERCENT_DECIMALS,
} from '../alko-benchmark';
import type {
  AlkoBenchmark,
  AlkoReferenceOffer,
} from '../benchmark.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = new Date('2026-01-15T10:00:00.000Z');
const T1 = new Date('2026-02-01T10:00:00.000Z');
const T2 = new Date('2026-03-10T10:00:00.000Z');

/** One Alko reference row with the module-test defaults, overridden per case. */
function refOffer(overrides: Partial<AlkoReferenceOffer> = {}): AlkoReferenceOffer {
  return {
    id: 1,
    priceCents: 1000,
    reliabilityStatus: 'VERIFIED',
    observedAt: T1,
    ...overrides,
  };
}

/** Distinct rows used to detect exactly which reference was selected. */
const DISTINCT_ROWS: AlkoReferenceOffer[] = [
  refOffer({ id: 7, priceCents: 1111, reliabilityStatus: 'STALE', observedAt: T1 }),
  refOffer({ id: 3, priceCents: 2222, reliabilityStatus: 'ESTIMATED', observedAt: T2 }),
  refOffer({ id: 12, priceCents: 3333, reliabilityStatus: 'UNAVAILABLE', observedAt: T0 }),
];

// ---------------------------------------------------------------------------
// Available result — exact numeric vectors
// ---------------------------------------------------------------------------

describe('computeAlkoBenchmark — available result', () => {
  it('pins the exported percentage precision constant', () => {
    expect(ALKO_BENCHMARK_PERCENT_DECIMALS).toBe(1);
  });

  /**
   * Exact vectors: (calculated, reference) → differenceCents,
   * differencePercent. The percent is the difference as a percentage OF
   * THE REFERENCE PRICE, rounded half away from zero to one decimal.
   */
  const VECTORS: ReadonlyArray<{
    calculated: number;
    reference: number;
    differenceCents: number;
    differencePercent: number;
  }> = [
    { calculated: 1250, reference: 1000, differenceCents: 250, differencePercent: 25 },
    { calculated: 750, reference: 1000, differenceCents: -250, differencePercent: -25 },
    { calculated: 1000, reference: 1000, differenceCents: 0, differencePercent: 0 },
    { calculated: 1337, reference: 999, differenceCents: 338, differencePercent: 33.8 },
    { calculated: 999, reference: 1337, differenceCents: -338, differencePercent: -25.3 },
    // Half cases: ±0.25 % must round AWAY from zero, not toward it.
    { calculated: 401, reference: 400, differenceCents: 1, differencePercent: 0.3 },
    { calculated: 399, reference: 400, differenceCents: -1, differencePercent: -0.3 },
    // Large-cent sanity: 23.457… % → 23.5.
    { calculated: 1234567, reference: 999999, differenceCents: 234568, differencePercent: 23.5 },
  ];

  for (const v of VECTORS) {
    it(`calculates ${v.calculated} vs ${v.reference} → ${v.differenceCents} ct / ${v.differencePercent} %`, () => {
      const result = computeAlkoBenchmark({
        calculatedPriceCents: v.calculated,
        alkoOffers: [refOffer({ priceCents: v.reference })],
      });

      expect(result).toEqual({
        status: 'available',
        referencePriceCents: v.reference,
        differenceCents: v.differenceCents,
        differencePercent: v.differencePercent,
        reliabilityStatus: 'VERIFIED',
        observedAt: T1,
      });
    });
  }

  it('carries the selected reference reliability and observedAt through verbatim', () => {
    const staleRow = refOffer({
      reliabilityStatus: 'STALE',
      observedAt: T2,
      priceCents: 1500,
    });
    const result = computeAlkoBenchmark({
      calculatedPriceCents: 1200,
      alkoOffers: [staleRow],
    });

    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.reliabilityStatus).toBe('STALE');
    expect(result.observedAt).toBe(staleRow.observedAt);
  });

  it('exposes exactly the documented field surface', () => {
    const result = computeAlkoBenchmark({
      calculatedPriceCents: 1250,
      alkoOffers: [refOffer()],
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'status',
        'referencePriceCents',
        'differenceCents',
        'differencePercent',
        'reliabilityStatus',
        'observedAt',
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Reference selection
// ---------------------------------------------------------------------------

describe('computeAlkoBenchmark — reference selection', () => {
  it('selects the most recent observedAt regardless of input order', () => {
    for (const rows of [DISTINCT_ROWS, [...DISTINCT_ROWS].reverse()]) {
      const result = computeAlkoBenchmark({
        calculatedPriceCents: 2500,
        alkoOffers: rows,
      });

      expect(result).toMatchObject({
        status: 'available',
        referencePriceCents: 2222, // row id 3, observedAt T2 — the newest
        reliabilityStatus: 'ESTIMATED',
        observedAt: T2,
      });
    }
  });

  it('breaks an observedAt tie on the higher offer id (later re-observation)', () => {
    const tie = [
      refOffer({ id: 7, priceCents: 1111, observedAt: T1 }),
      refOffer({ id: 12, priceCents: 2222, observedAt: T1 }),
    ];
    for (const rows of [tie, [...tie].reverse()]) {
      const result = computeAlkoBenchmark({
        calculatedPriceCents: 2000,
        alkoOffers: rows,
      });
      expect(result).toMatchObject({
        status: 'available',
        referencePriceCents: 2222, // id 12 — the later insert
      });
    }
  });

  it('is stable on a full tie (same id and observedAt): first row wins', () => {
    const result = computeAlkoBenchmark({
      calculatedPriceCents: 2000,
      alkoOffers: [
        refOffer({ id: 5, priceCents: 1111, observedAt: T1 }),
        refOffer({ id: 5, priceCents: 2222, observedAt: T1 }),
      ],
    });
    expect(result).toMatchObject({
      status: 'available',
      referencePriceCents: 1111,
    });
  });
});

// ---------------------------------------------------------------------------
// Unavailable results
// ---------------------------------------------------------------------------

describe('computeAlkoBenchmark — unavailable results', () => {
  /** The full explicit no-value shape every unavailable case must return. */
  function expectUnavailable(result: AlkoBenchmark, reason: string): void {
    expect(result).toEqual({
      status: 'unavailable',
      reason,
      referencePriceCents: null,
      differenceCents: null,
      differencePercent: null,
      reliabilityStatus: null,
      observedAt: null,
    });
  }

  it('reports NO_REFERENCE_OFFER for an empty reference list — absence is normal', () => {
    expectUnavailable(
      computeAlkoBenchmark({ calculatedPriceCents: 1250, alkoOffers: [] }),
      'NO_REFERENCE_OFFER',
    );
  });

  it('reports INVALID_CALCULATED_PRICE for non-integer, negative, or non-finite prices', () => {
    for (const price of [NaN, Infinity, -Infinity, -1, 12.5]) {
      expectUnavailable(
        computeAlkoBenchmark({ calculatedPriceCents: price, alkoOffers: [refOffer()] }),
        'INVALID_CALCULATED_PRICE',
      );
    }
  });

  it('reports INVALID_REFERENCE_OFFER when any single row is corrupt (fail-closed)', () => {
    const corruptRows: AlkoReferenceOffer[] = [
      refOffer({ priceCents: 0 }), // percent would divide by zero
      refOffer({ priceCents: -5 }),
      refOffer({ priceCents: 10.5 }),
      refOffer({ priceCents: NaN }),
      refOffer({ id: 1.5 }),
      refOffer({ observedAt: new Date('not-a-date') }),
    ];
    for (const corrupt of corruptRows) {
      expectUnavailable(
        computeAlkoBenchmark({
          calculatedPriceCents: 1250,
          alkoOffers: [refOffer(), corrupt], // valid row present — still suppressed
        }),
        'INVALID_REFERENCE_OFFER',
      );
    }
  });

  it('accepts a zero calculated price as structurally valid input', () => {
    const result = computeAlkoBenchmark({
      calculatedPriceCents: 0,
      alkoOffers: [refOffer({ priceCents: 800 })],
    });
    expect(result).toMatchObject({
      status: 'available',
      differenceCents: -800,
      differencePercent: -100,
    });
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('computeAlkoBenchmark — purity', () => {
  it('never mutates its input', () => {
    const offers = [refOffer({ id: 7, observedAt: T0 }), refOffer({ id: 3, observedAt: T2 })];
    const input = { calculatedPriceCents: 1250, alkoOffers: offers };
    const snapshot = structuredClone(input);

    computeAlkoBenchmark(input);

    expect(input).toEqual(snapshot);
    expect(offers).toHaveLength(2);
  });

  it('is deterministic: repeated calls with equal input give equal output', () => {
    const input = {
      calculatedPriceCents: 1337,
      alkoOffers: DISTINCT_ROWS,
    };
    expect(computeAlkoBenchmark(input)).toEqual(computeAlkoBenchmark(input));
  });
});

/**
 * Tests for the empirical-margin calibration — the p80 relative-error
 * quantile, the per-cell calibration, and the ladder resolution
 * (design D3).
 *
 * The properties pinned here are the honesty contract: null below the
 * sample floor (never a fabricated number), ladder monotonicity (a
 * deeper cell never resolves wider than its qualifying parent), and
 * determinism (same input, same margin; input order irrelevant). The
 * quantile math is asserted against hand-computed fixtures, and the
 * inclusive boundary — a report exactly at the margin is within — is
 * pinned explicitly.
 *
 * Pure functions — no DB, no mocks, seeded PRNG for the property run.
 *
 * @module MarginCalibrationTests
 */
import { describe, it, expect } from 'vitest';
import {
  computeCellMargin,
  quantileOfRelativeErrors,
  relativeErrorFraction,
  resolveEmpiricalMargin,
} from '../margin-calibration';
import type { OutcomeMarginReport } from '../margin-calibration.types';
import {
  categoryCarrierCellKey,
  GLOBAL_CELL_KEY,
  MARGIN_QUANTILE_P,
  MARGIN_SAMPLE_FLOOR,
} from '../margin-calibration.types';
import { InvalidOutcomeInputError } from '../outcomes.types';

const AS_OF = new Date('2026-10-01T00:00:00.000Z');
const ESTIMATE = 10_000;

/** A report over the standard 10 000 ¢ estimate at a given relative error. */
function reportAt(
  error: number,
  overrides?: Partial<OutcomeMarginReport>,
): OutcomeMarginReport {
  return {
    reportedTotalCents: ESTIMATE + Math.round(error * ESTIMATE),
    estimatedTotalCents: ESTIMATE,
    category: 'beer',
    carrier: 'posti',
    ...overrides,
  };
}

/** Run `attempt`, returning the typed error; fail loudly when nothing throws. */
function captureError(attempt: () => unknown): InvalidOutcomeInputError {
  try {
    attempt();
  } catch (err) {
    return err as InvalidOutcomeInputError;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

function expectReason(
  attempt: () => unknown,
  reason: InvalidOutcomeInputReason,
): void {
  const err = captureError(attempt);
  expect(err).toBeInstanceOf(InvalidOutcomeInputError);
  expect(err.reason).toBe(reason);
}

type InvalidOutcomeInputReason = InvalidOutcomeInputError['reason'];

/** Deterministic seeded PRNG (mulberry32) — the property run must not flake. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('margin calibration constants', () => {
  it('the sample floor is 10 and the quantile is p80', () => {
    expect(MARGIN_SAMPLE_FLOOR).toBe(10);
    expect(MARGIN_QUANTILE_P).toBe(0.8);
  });

  it('the composite cell key joins category and carrier deterministically', () => {
    expect(categoryCarrierCellKey('beer', 'posti')).toBe('beer|posti');
    expect(categoryCarrierCellKey('wine_still', 'matkahuolto')).toBe(
      'wine_still|matkahuolto',
    );
  });

  it('the global cell key is the pinned literal', () => {
    expect(GLOBAL_CELL_KEY).toBe('global');
  });
});

// ---------------------------------------------------------------------------
// Relative error
// ---------------------------------------------------------------------------

describe('relativeErrorFraction', () => {
  it('computes |reported − estimated| / estimated in both directions', () => {
    expect(relativeErrorFraction(10_100, 10_000)).toBe(0.01);
    expect(relativeErrorFraction(9_900, 10_000)).toBe(0.01);
    expect(relativeErrorFraction(10_000, 10_000)).toBe(0);
  });

  it.each([
    ['zero estimate (relative error undefined)', 10_000, 0],
    ['negative estimate', 10_000, -5],
    ['negative report', -1, 10_000],
    ['NaN report', Number.NaN, 10_000],
    ['Infinity estimate', 10_000, Number.POSITIVE_INFINITY],
  ] as const)('%s throws INVALID_MARGIN_INPUT', (_label, reported, estimated) => {
    expectReason(() => relativeErrorFraction(reported, estimated), 'INVALID_MARGIN_INPUT');
  });
});

// ---------------------------------------------------------------------------
// Quantile — exact hand-computed fixtures
// ---------------------------------------------------------------------------

describe('quantileOfRelativeErrors — exact numbers', () => {
  it('ten ordered values 0.01…0.10 → p80 is the 8th smallest, 0.08', () => {
    // rank = ⌈0.8 · 10⌉ = 8 → sorted[7]
    const errors = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];
    expect(quantileOfRelativeErrors(errors)).toBe(0.08);
  });

  it('twelve values → rank ⌈9.6⌉ = 10 → the 10th smallest (5)', () => {
    const errors = [1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 9, 9];
    expect(quantileOfRelativeErrors(errors)).toBe(5);
  });

  it('fifteen equal values → rank ⌈12⌉ = 12 (0.8·15 snapped free of float dust)', () => {
    expect(quantileOfRelativeErrors(new Array(15).fill(0.02))).toBe(0.02);
  });

  it('eleven values → rank ⌈8.8⌉ = 9 → the 9th smallest', () => {
    const errors = [...new Array(10).fill(0.01), 0.99];
    expect(quantileOfRelativeErrors(errors)).toBe(0.01);
  });

  it('input order is irrelevant: permutations share the quantile', () => {
    const ordered = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];
    const shuffled = [0.07, 0.02, 0.1, 0.04, 0.08, 0.01, 0.06, 0.03, 0.09, 0.05];
    expect(quantileOfRelativeErrors(shuffled)).toBe(quantileOfRelativeErrors(ordered));
    expect(ordered).toEqual([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]);
  });

  it('empty and degenerate samples throw instead of fabricating', () => {
    expectReason(() => quantileOfRelativeErrors([]), 'INVALID_MARGIN_INPUT');
    expectReason(
      () => quantileOfRelativeErrors([0.01, Number.NaN]),
      'INVALID_MARGIN_INPUT',
    );
    expectReason(() => quantileOfRelativeErrors([0.01, -0.5]), 'INVALID_MARGIN_INPUT');
  });
});

// ---------------------------------------------------------------------------
// Property: inclusive quantile
// ---------------------------------------------------------------------------

describe('quantileOfRelativeErrors — inclusive boundary', () => {
  it('the quantile is an observed sample value covering ≥ 80% of the sample', () => {
    const errors = [0.03, 0.01, 0.09, 0.05, 0.07, 0.02, 0.1, 0.04, 0.06, 0.08];
    const q = quantileOfRelativeErrors(errors);
    expect(errors).toContain(q);
    const within = errors.filter((e) => e <= q).length;
    expect(within).toBe(8);
    expect(within / errors.length).toBeGreaterThanOrEqual(MARGIN_QUANTILE_P);
  });

  it('a report whose relative error equals the p80 boundary is within the hedge', () => {
    // the boundary member 0.08 itself: e ≤ q holds — inclusive, never exclusive
    const errors = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1];
    const q = quantileOfRelativeErrors(errors);
    expect(0.08 <= q).toBe(true);
  });

  it('an all-equal sample puts every report exactly at the quantile', () => {
    const q = quantileOfRelativeErrors(new Array(10).fill(0.05));
    expect(q).toBe(0.05);
    expect(new Array(10).fill(0.05).filter((e) => e <= q).length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Per-cell calibration — the N ≥ 10 floor
// ---------------------------------------------------------------------------

describe('computeCellMargin — no fabrication below the floor', () => {
  it('an empty corpus yields null, never a number', () => {
    expect(
      computeCellMargin([], 'global', null, null, AS_OF),
    ).toBeNull();
    expect(
      computeCellMargin([], 'category', 'beer', null, AS_OF),
    ).toBeNull();
  });

  it('nine reports (one below the floor) yield null even with wild errors', () => {
    const reports = Array.from({ length: MARGIN_SAMPLE_FLOOR - 1 }, (_, i) =>
      reportAt(i % 2 === 0 ? 0.9 : 0.001),
    );
    expect(computeCellMargin(reports, 'global', null, null, AS_OF)).toBeNull();
    expect(
      computeCellMargin(reports, 'category_carrier', 'beer', 'posti', AS_OF),
    ).toBeNull();
  });

  it('exactly ten reports meet the floor (N ≥ 10 inclusive)', () => {
    const reports = Array.from({ length: MARGIN_SAMPLE_FLOOR }, (_, i) =>
      reportAt(0.01 * (i + 1)),
    );
    const margin = computeCellMargin(reports, 'category_carrier', 'beer', 'posti', AS_OF);
    expect(margin).not.toBeNull();
    expect(margin!.quantile).toBe(800 / ESTIMATE);
    expect(margin!.sampleCount).toBe(10);
  });

  it('attribution is join-honest: null-valued reports never reach a named cell', () => {
    const reports = [
      ...Array.from({ length: 10 }, () => reportAt(0.02)),
      reportAt(0.5, { category: null }),
      reportAt(0.6, { carrier: null }),
    ];
    const cell = computeCellMargin(
      reports,
      'category_carrier',
      'beer',
      'posti',
      AS_OF,
    );
    // only the 10 fully-attributed reports; the null-valued two are excluded
    expect(cell!.sampleCount).toBe(10);
    expect(cell!.quantile).toBe(0.02);

    // …but the global cell counts every report, resolved or not
    const global = computeCellMargin(reports, 'global', null, null, AS_OF);
    expect(global!.sampleCount).toBe(12);
  });

  it('cells needing a value cannot be asked without it (caller bug → throw)', () => {
    expectReason(
      () => computeCellMargin([], 'category_carrier', 'beer', null, AS_OF),
      'INVALID_MARGIN_INPUT',
    );
    expectReason(
      () => computeCellMargin([], 'category', null, null, AS_OF),
      'INVALID_MARGIN_INPUT',
    );
  });

  it('passes asOf through unchanged', () => {
    const margin = computeCellMargin(
      Array.from({ length: 10 }, () => reportAt(0.02)),
      'global',
      null,
      null,
      AS_OF,
    );
    expect(margin!.asOf).toBe(AS_OF);
  });
});

// ---------------------------------------------------------------------------
// Ladder resolution
// ---------------------------------------------------------------------------

describe('resolveEmpiricalMargin — ladder order', () => {
  /** Ten beer×posti reports at 2% plus ten beer×matkahuolto at 4%. */
  function deepAndParentCorpus(): OutcomeMarginReport[] {
    return [
      ...Array.from({ length: 10 }, () =>
        reportAt(0.02, { carrier: 'posti' }),
      ),
      ...Array.from({ length: 10 }, () =>
        reportAt(0.04, { carrier: 'matkahuolto' }),
      ),
    ];
  }

  it('the deepest qualifying rung wins the cell', () => {
    const margin = resolveEmpiricalMargin(
      deepAndParentCorpus(),
      { category: 'beer', carrier: 'posti' },
      AS_OF,
    );
    expect(margin).toEqual({
      quantile: 0.02,
      sampleCount: 10,
      cell: { dimension: 'category_carrier', key: 'beer|posti' },
      asOf: AS_OF,
    });
  });

  it('a deep rung below the floor falls back to the category rung', () => {
    const reports = [
      ...Array.from({ length: 4 }, () => reportAt(0.02, { carrier: 'posti' })),
      ...Array.from({ length: 12 }, () =>
        reportAt(0.04, { carrier: 'matkahuolto' }),
      ),
    ];
    const margin = resolveEmpiricalMargin(
      reports,
      { category: 'beer', carrier: 'posti' },
      AS_OF,
    );
    expect(margin!.cell).toEqual({ dimension: 'category', key: 'beer' });
    expect(margin!.quantile).toBe(0.04);
    expect(margin!.sampleCount).toBe(16);
  });

  it('everything below the floor but the global rung resolves global', () => {
    const reports = [
      reportAt(0.02, { carrier: 'posti' }),
      reportAt(0.03, { carrier: 'matkahuolto' }),
      ...Array.from({ length: 8 }, () =>
        reportAt(0.05, { category: 'wine_still', carrier: 'dhl' }),
      ),
    ];
    const margin = resolveEmpiricalMargin(
      reports,
      { category: 'beer', carrier: 'posti' },
      AS_OF,
    );
    expect(margin!.cell).toEqual({ dimension: 'global', key: 'global' });
    expect(margin!.sampleCount).toBe(10);
  });

  it('below the floor everywhere → honest null, never a number', () => {
    const reports = Array.from({ length: MARGIN_SAMPLE_FLOOR - 1 }, () =>
      reportAt(0.9),
    );
    expect(
      resolveEmpiricalMargin(reports, { category: 'beer', carrier: 'posti' }, AS_OF),
    ).toBeNull();
    expect(resolveEmpiricalMargin([], { category: 'beer', carrier: 'posti' }, AS_OF))
      .toBeNull();
  });

  it('an unknown category cannot enter category rungs — no carrier-only rung exists', () => {
    const reports = deepAndParentCorpus();
    const margin = resolveEmpiricalMargin(
      reports,
      { category: null, carrier: 'posti' },
      AS_OF,
    );
    expect(margin!.cell).toEqual({ dimension: 'global', key: 'global' });
    // global over the same corpus: 20 reports mixing 2% and 4% errors
    expect(margin!.sampleCount).toBe(20);
    // rank ⌈0.8·20⌉ = 16 → sorted[15] = 0.04
    expect(margin!.quantile).toBe(0.04);
  });

  it('an unknown carrier still reaches the category rung', () => {
    const margin = resolveEmpiricalMargin(
      deepAndParentCorpus(),
      { category: 'beer', carrier: null },
      AS_OF,
    );
    expect(margin!.cell).toEqual({ dimension: 'category', key: 'beer' });
    expect(margin!.sampleCount).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Property: ladder monotonicity
// ---------------------------------------------------------------------------

describe('resolveEmpiricalMargin — ladder monotonicity', () => {
  it('fixture pin: raw deep p80 (0.5) wider than parent p80 (0.01) resolves clamped', () => {
    // Deep cell: 7 reports at 1% + the three outliers → raw p80 = 0.5.
    // Parent (beer): the same 10 + 10 more at 1% → p80 = 0.01 (rank 16 of 20).
    // The resolved deep margin must not exceed the parent's.
    const reports = [
      ...Array.from({ length: 7 }, () => reportAt(0.01)),
      reportAt(0.5),
      reportAt(0.6),
      reportAt(0.7),
      ...Array.from({ length: 10 }, () =>
        reportAt(0.01, { carrier: 'matkahuolto' }),
      ),
    ];
    const deep = resolveEmpiricalMargin(
      reports,
      { category: 'beer', carrier: 'posti' },
      AS_OF,
    );
    const parent = resolveEmpiricalMargin(
      reports,
      { category: 'beer', carrier: null },
      AS_OF,
    );
    // basis still describes the winning deep rung…
    expect(deep!.cell).toEqual({ dimension: 'category_carrier', key: 'beer|posti' });
    expect(deep!.sampleCount).toBe(10);
    // …while the quantile is clamped to the qualifying ancestors' minimum
    expect(deep!.quantile).toBe(0.01);
    expect(parent!.quantile).toBe(0.01);
    expect(deep!.quantile).toBeLessThanOrEqual(parent!.quantile);
  });

  it('property: over seeded random corpora the deep margin never exceeds a qualifying parent or global', () => {
    const categories = ['beer', 'wine_still'] as const;
    const carriers = ['posti', 'matkahuolto'] as const;

    for (let seed = 1; seed <= 40; seed++) {
      const rand = seededRandom(seed);
      const reports: OutcomeMarginReport[] = Array.from({ length: 60 }, () => {
        const estimatedTotalCents = 5_000 + Math.floor(rand() * 20_000);
        const error = rand() * 0.3;
        const sign = rand() < 0.5 ? 1 : -1;
        return {
          reportedTotalCents: Math.max(
            1,
            Math.round(estimatedTotalCents * (1 + sign * error)),
          ),
          estimatedTotalCents,
          category: rand() < 0.6 ? categories[0] : categories[1],
          carrier: rand() < 0.6 ? carriers[0] : carriers[1],
        };
      });

      const query = { category: categories[0], carrier: carriers[0] };
      const deepCount = reports.filter(
        (r) => r.category === query.category && r.carrier === query.carrier,
      ).length;
      const parentCount = reports.filter((r) => r.category === query.category).length;

      const deep = resolveEmpiricalMargin(reports, query, AS_OF);
      const parent = resolveEmpiricalMargin(
        reports,
        { category: query.category, carrier: null },
        AS_OF,
      );
      const global = resolveEmpiricalMargin(
        reports,
        { category: null, carrier: null },
        AS_OF,
      );

      if (deepCount >= MARGIN_SAMPLE_FLOOR) {
        // whenever the deep cell qualifies, its margin is at most every
        // qualifying rung's on the path — monotone narrowing, never widening
        expect(deep).not.toBeNull();
        if (parentCount >= MARGIN_SAMPLE_FLOOR) {
          expect(parent).not.toBeNull();
          expect(deep!.quantile).toBeLessThanOrEqual(parent!.quantile);
        }
        expect(global).not.toBeNull();
        expect(deep!.quantile).toBeLessThanOrEqual(global!.quantile);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property: determinism and no fabrication
// ---------------------------------------------------------------------------

describe('resolveEmpiricalMargin — determinism', () => {
  it('the same corpus and query always produce an identical margin', () => {
    const rand = seededRandom(1234);
    const reports: OutcomeMarginReport[] = Array.from({ length: 40 }, () => {
      const estimatedTotalCents = 5_000 + Math.floor(rand() * 10_000);
      return {
        reportedTotalCents: Math.round(estimatedTotalCents * (1 + rand() * 0.2)),
        estimatedTotalCents,
        category: 'beer',
        carrier: rand() < 0.5 ? 'posti' : 'matkahuolto',
      };
    });
    const query = { category: 'beer', carrier: 'posti' };
    const first = resolveEmpiricalMargin(reports, query, AS_OF);
    const second = resolveEmpiricalMargin(reports, query, AS_OF);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(second!.quantile).toBe(first!.quantile);
  });

  it('report order never changes the outcome', () => {
    const reports = [
      ...Array.from({ length: 10 }, () => reportAt(0.02, { carrier: 'posti' })),
      ...Array.from({ length: 6 }, () =>
        reportAt(0.07, { carrier: 'matkahuolto' }),
      ),
      ...Array.from({ length: 6 }, () =>
        reportAt(0.11, { carrier: 'matkahuolto' }),
      ),
    ];
    const query = { category: 'beer', carrier: 'posti' };
    const forward = resolveEmpiricalMargin(reports, query, AS_OF);
    const reversed = resolveEmpiricalMargin([...reports].reverse(), query, AS_OF);
    expect(reversed).toEqual(forward);
  });

  it('the corpus is never mutated by calibration', () => {
    const reports = Array.from({ length: 10 }, (_, i) => reportAt(0.01 * (i + 1)));
    const snapshot = reports.map((r) => ({ ...r }));
    resolveEmpiricalMargin(reports, { category: 'beer', carrier: 'posti' }, AS_OF);
    expect(reports).toEqual(snapshot);
  });
});

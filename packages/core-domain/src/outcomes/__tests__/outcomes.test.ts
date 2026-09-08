/**
 * Tests for the pure calculation-outcome domain logic — submission
 * validation (60-day window, one-per-record, positive cents,
 * ownership), the 5% margin comparison, and the aggregation.
 *
 * The window and margin boundaries are spec-fixed, so the vectors
 * assert exact boundary instants and cents. Pure functions — the clock
 * is injected, no DB, no mocks.
 *
 * @module OutcomesTests
 */
import { describe, it, expect } from 'vitest';
import {
  isWithinSubmissionWindow,
  validateOutcomeSubmission,
  isWithinMargin,
  aggregateOutcomeAccuracy,
} from '../outcomes';
import {
  InvalidOutcomeInputError,
  OUTCOME_SUBMISSION_WINDOW,
  USER_REPORTED_OUTCOMES_LABEL_EN,
  USER_REPORTED_OUTCOMES_LABEL_FI,
  WITHIN_MARGIN_FRACTION,
} from '../outcomes.types';

const DAY_MS = 86_400_000;
const RECORD_TS = new Date('2026-01-01T12:00:00.000Z');

/** A submission whose port-resolved facts are all healthy. */
function healthyInput(overrides?: Partial<Parameters<typeof validateOutcomeSubmission>[0]>) {
  return {
    calculationRecordId: 'rec-1',
    accountId: 'acct-1',
    reportedTotalCents: 10_500,
    recordCalculationTimestamp: RECORD_TS,
    now: new Date(RECORD_TS.getTime() + 30 * DAY_MS),
    recordOwnerAccountId: 'acct-1',
    existingOutcomeId: null,
    ...overrides,
  };
}

/** Run `attempt`, returning the thrown error; fail loudly when nothing throws. */
function captureError(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

function expectReason(attempt: () => unknown, reason: InvalidOutcomeInputError['reason']): void {
  const err = captureError(attempt);
  expect(err).toBeInstanceOf(InvalidOutcomeInputError);
  expect((err as InvalidOutcomeInputError).reason).toBe(reason);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('outcome constants', () => {
  it('submission window is exactly 60 days', () => {
    expect(OUTCOME_SUBMISSION_WINDOW.milliseconds).toBe(60 * DAY_MS);
  });

  it('margin fraction is exactly 5%', () => {
    expect(WITHIN_MARGIN_FRACTION).toBe(0.05);
  });

  it('exports the user-reported labels in both languages', () => {
    expect(USER_REPORTED_OUTCOMES_LABEL_FI).toContain('käyttäjien ilmoittamiin');
    expect(USER_REPORTED_OUTCOMES_LABEL_EN).toBe(
      'Based on user-reported outcomes',
    );
  });
});

// ---------------------------------------------------------------------------
// Submission window — boundary instants
// ---------------------------------------------------------------------------

describe('isWithinSubmissionWindow — boundary windows', () => {
  it.each([
    ['0 days (same instant)', 0, true],
    ['59 days', 59 * DAY_MS, true],
    ['exactly 60 days (inclusive boundary)', 60 * DAY_MS, true],
    ['61 days', 61 * DAY_MS, false],
    ['60 days + 1 ms (first invalid instant)', 60 * DAY_MS + 1, false],
  ] as const)('%s → %s', (_label, elapsedMs, expected) => {
    expect(
      isWithinSubmissionWindow(RECORD_TS, new Date(RECORD_TS.getTime() + elapsedMs)),
    ).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

describe('validateOutcomeSubmission — happy path', () => {
  it('accepts a valid submission and returns the canonical fields to persist', () => {
    expect(validateOutcomeSubmission(healthyInput())).toEqual({
      calculationRecordId: 'rec-1',
      accountId: 'acct-1',
      reportedTotalCents: 10_500,
      recordCalculationTimestamp: RECORD_TS,
    });
  });
});

describe('validateOutcomeSubmission — window', () => {
  it('a submission exactly on the 60th day is accepted', () => {
    const input = healthyInput({
      now: new Date(RECORD_TS.getTime() + 60 * DAY_MS),
    });
    expect(validateOutcomeSubmission(input).reportedTotalCents).toBe(10_500);
  });

  it('a submission 61 days after the record throws WINDOW_EXPIRED', () => {
    expectReason(
      () =>
        validateOutcomeSubmission(
          healthyInput({ now: new Date(RECORD_TS.getTime() + 61 * DAY_MS) }),
        ),
      'WINDOW_EXPIRED',
    );
  });
});

describe('validateOutcomeSubmission — one per record+account (duplicate)', () => {
  it('a second outcome for the same record+account throws OUTCOME_ALREADY_EXISTS', () => {
    expectReason(
      () =>
        validateOutcomeSubmission(healthyInput({ existingOutcomeId: 'out-9' })),
      'OUTCOME_ALREADY_EXISTS',
    );
  });

  it('the same account reporting on a different record is not a duplicate', () => {
    const input = healthyInput({
      calculationRecordId: 'rec-2',
      existingOutcomeId: null,
    });
    expect(() => validateOutcomeSubmission(input)).not.toThrow();
  });
});

describe('validateOutcomeSubmission — ownership contract', () => {
  it('an account cannot report someone else\'s record: NOT_RECORD_OWNER', () => {
    expectReason(
      () =>
        validateOutcomeSubmission(
          healthyInput({ recordOwnerAccountId: 'acct-other' }),
        ),
      'NOT_RECORD_OWNER',
    );
  });

  it('an unknown record (port resolved null owner) throws RECORD_NOT_FOUND', () => {
    expectReason(
      () => validateOutcomeSubmission(healthyInput({ recordOwnerAccountId: null })),
      'RECORD_NOT_FOUND',
    );
  });
});

describe('validateOutcomeSubmission — positive cents', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional cents (never rounded)', 1050.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['non-numeric', '10500'],
  ] as const)('%s reported total throws REPORTED_TOTAL_NOT_POSITIVE', (_label, bad) => {
    expectReason(
      () => validateOutcomeSubmission(healthyInput({ reportedTotalCents: bad })),
      'REPORTED_TOTAL_NOT_POSITIVE',
    );
  });

  it('one cent is a valid reported total', () => {
    expect(() =>
      validateOutcomeSubmission(healthyInput({ reportedTotalCents: 1 })),
    ).not.toThrow();
  });
});

describe('validateOutcomeSubmission — structural ids', () => {
  it('blank calculationRecordId throws MISSING_RECORD_ID', () => {
    for (const bad of [undefined, null, '', '   ']) {
      expectReason(
        () =>
          validateOutcomeSubmission(healthyInput({ calculationRecordId: bad })),
        'MISSING_RECORD_ID',
      );
    }
  });

  it('blank accountId throws MISSING_ACCOUNT_ID', () => {
    for (const bad of [undefined, null, '', '   ']) {
      expectReason(
        () => validateOutcomeSubmission(healthyInput({ accountId: bad })),
        'MISSING_ACCOUNT_ID',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Margin comparison
// ---------------------------------------------------------------------------

describe('isWithinMargin — 5% boundary', () => {
  it('a deviation of exactly 5% of the estimate is within margin', () => {
    // |10500 − 10000| = 500 = 0.05 × 10000
    expect(isWithinMargin(10_500, 10_000)).toBe(true);
    // under-reporting by exactly 5% is equally within margin
    expect(isWithinMargin(9_500, 10_000)).toBe(true);
  });

  it('one cent beyond 5% is outside the margin', () => {
    expect(isWithinMargin(10_501, 10_000)).toBe(false);
    expect(isWithinMargin(9_499, 10_000)).toBe(false);
  });

  it('an exact report and small deviations are within margin', () => {
    expect(isWithinMargin(10_000, 10_000)).toBe(true);
    expect(isWithinMargin(10_100, 10_000)).toBe(true);
  });

  it('a zero estimate is within margin only for an exact zero report', () => {
    expect(isWithinMargin(0, 0)).toBe(true);
    expect(isWithinMargin(1, 0)).toBe(false);
  });

  it('negative or non-finite totals throw INVALID_MARGIN_INPUT', () => {
    expectReason(() => isWithinMargin(-1, 10_000), 'INVALID_MARGIN_INPUT');
    expectReason(() => isWithinMargin(10_500, -10_000), 'INVALID_MARGIN_INPUT');
    expectReason(() => isWithinMargin(Number.NaN, 10_000), 'INVALID_MARGIN_INPUT');
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe('aggregateOutcomeAccuracy', () => {
  const asOf = new Date('2026-03-01T00:00:00.000Z');

  it('counts and shares over a mixed corpus: 3 of 4 within margin', () => {
    const stat = aggregateOutcomeAccuracy(
      [
        { reportedTotalCents: 10_000, estimatedTotalCents: 10_000 }, // within (exact)
        { reportedTotalCents: 10_500, estimatedTotalCents: 10_000 }, // within (exactly 5%)
        { reportedTotalCents: 10_501, estimatedTotalCents: 10_000 }, // outside
        { reportedTotalCents: 9_600, estimatedTotalCents: 10_000 }, // within
      ],
      asOf,
    );
    expect(stat).toEqual({ count: 4, withinMarginShare: 0.75, asOf });
  });

  it('a corpus where every outcome is outside the margin reports a honest 0 share', () => {
    const stat = aggregateOutcomeAccuracy(
      [
        { reportedTotalCents: 20_000, estimatedTotalCents: 10_000 },
        { reportedTotalCents: 5_000, estimatedTotalCents: 10_000 },
      ],
      asOf,
    );
    expect(stat).toEqual({ count: 2, withinMarginShare: 0, asOf });
  });

  it('empty state: count 0 and NO fabricated percentage (share null)', () => {
    const stat = aggregateOutcomeAccuracy([], asOf);
    expect(stat.count).toBe(0);
    expect(stat.withinMarginShare).toBeNull();
    expect(stat.asOf).toBe(asOf);
  });

  it('passes asOf through unchanged', () => {
    const other = new Date('2026-06-15T09:30:00.000Z');
    expect(aggregateOutcomeAccuracy(
      [{ reportedTotalCents: 100, estimatedTotalCents: 100 }],
      other,
    ).asOf).toBe(other);
  });
});

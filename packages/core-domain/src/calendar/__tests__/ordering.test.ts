/**
 * Unit tests for the deterministic calendar order (spec: tax-change-
 * calendar, "Public deterministic calendar API"): period start, then
 * CONFIRMED before EXPECTED in the same period, then event type, then
 * id — with nothing else in the comparator beyond these identity keys.
 *
 * The repeated-request scenario pins determinism, so the suite proves
 * the order is invariant under input permutation and identical across
 * runs — no locale collation, no clock, no randomness.
 */
import { describe, expect, it } from 'vitest';

import {
  InvalidCalendarInputError,
  type CalendarEvent,
} from '../calendar.types';
import {
  compareCalendarEvents,
  resolveExpectedWindow,
  resolvePeriodStart,
  resolveWindowEnd,
  sortCalendarEvents,
} from '../ordering';

// ---------------------------------------------------------------------------
// Fixtures — the verified 2026 event set (change task 1.1)
// ---------------------------------------------------------------------------

let nextId = 1;

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'eventType' | 'status'>): CalendarEvent {
  return {
    id: nextId++,
    year: 2026,
    occurrenceDate: null,
    expectedWindow: null,
    titleFi: 'Otsikko',
    titleEn: 'Title',
    summaryFi: 'Yhteenveto',
    summaryEn: 'Summary',
    sourceUrl: 'https://www.vero.fi/example',
    ...overrides,
  };
}

/** The six verified 2026 rows, deliberately provided out of order. */
function verifiedSet2026(): CalendarEvent[] {
  return [
    event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-09' }),
    event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' }),
    event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' }),
    event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-08-06' }),
    event({ eventType: 'EE_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' }),
    event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-03' }),
  ];
}

/** The stated order of the 2026 set: period start, then the tie-breaks. */
const VERIFIED_2026_ORDER = [
  'EE_EXCISE_CHANGE', // 2026-01-01, alphabetical before FI at the same period
  'FI_EXCISE_CHANGE', // 2026-01-01
  'ALKO_PRICE_LIST', // window 2026-03 → 2026-03-01
  'TAX_TABLE_PUBLICATION', // 2026-08-06
  'ALKO_PRICE_LIST', // window 2026-09 → 2026-09-01
  'RATE_DECISION', // window 2026-Q4 → 2026-10-01
] as const;

// ---------------------------------------------------------------------------
// Ordering — the documented keys, one by one
// ---------------------------------------------------------------------------

describe('compareCalendarEvents — documented keys', () => {
  it('orders the verified 2026 set by period start', () => {
    const sorted = sortCalendarEvents(verifiedSet2026());
    expect(sorted.map((e) => e.eventType)).toEqual([...VERIFIED_2026_ORDER]);
  });

  it('maps expected windows onto their start days: month → 1st, quarter → first month of the quarter', () => {
    const sorted = sortCalendarEvents(verifiedSet2026());
    expect(sorted.map((e) => resolvePeriodStart(e))).toEqual([
      '2026-01-01',
      '2026-01-01',
      '2026-03-01',
      '2026-08-06',
      '2026-09-01',
      '2026-10-01',
    ]);
  });

  it('breaks the same period by status: CONFIRMED day precision before an EXPECTED window', () => {
    const confirmed = event({ eventType: 'RATE_DECISION', status: 'CONFIRMED', occurrenceDate: '2026-10-01' });
    const expected = event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' });

    expect(compareCalendarEvents(confirmed, expected)).toBeLessThan(0);
    expect(compareCalendarEvents(expected, confirmed)).toBeGreaterThan(0);
  });

  it('breaks the same period and status by event type (code-unit ascending)', () => {
    // Both CONFIRMED on 2026-01-01 — the verified EE/FI pair.
    const fi = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' });
    const ee = event({ eventType: 'EE_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' });

    expect(compareCalendarEvents(ee, fi)).toBeLessThan(0);
    expect(compareCalendarEvents(fi, ee)).toBeGreaterThan(0);
  });

  it('breaks a full tie by id ascending — no two distinct rows compare equal', () => {
    const first = event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-03' });
    const second = event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-03' });

    expect(compareCalendarEvents(first, second)).toBeLessThan(0);
    expect(compareCalendarEvents(second, first)).toBeGreaterThan(0);
    expect(compareCalendarEvents(first, first)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input, same order, every run, any permutation
// ---------------------------------------------------------------------------

describe('sortCalendarEvents — determinism', () => {
  it('produces identical output from any input permutation', () => {
    const events = verifiedSet2026();
    const reference = JSON.stringify(sortCalendarEvents(events).map((e) => e.id));

    const permutations: CalendarEvent[][] = [
      [...events].reverse(),
      [...events.slice(1), events[0]],
      [events[3], events[0], events[5], events[2], events[1], events[4]],
      [events[5], events[4], events[3], events[2], events[1], events[0]],
    ];

    for (const permutation of permutations) {
      expect(JSON.stringify(sortCalendarEvents(permutation).map((e) => e.id))).toBe(reference);
    }
  });

  it('produces identical output across repeated runs on the same input', () => {
    const events = verifiedSet2026();
    const first = sortCalendarEvents(events);
    const second = sortCalendarEvents(events);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.map((e) => e.id)).toEqual(first.map((e) => e.id));
  });

  it('never mutates the input array', () => {
    const input = verifiedSet2026();
    const snapshot = [...input];

    const sorted = sortCalendarEvents(input);

    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Window resolution — the period arithmetic the ordering relies on
// ---------------------------------------------------------------------------

describe('resolveExpectedWindow', () => {
  it('resolves month windows: start on the 1st, end on the month’s last day', () => {
    expect(resolveExpectedWindow('2026-09')).toEqual({
      year: 2026,
      startMonth: 9,
      endMonth: 9,
      startDay: '2026-09-01',
      endDay: '2026-09-30',
    });
    expect(resolveExpectedWindow('2026-12').endDay).toBe('2026-12-31');
    expect(resolveExpectedWindow('2026-04').endDay).toBe('2026-04-30');
  });

  it('resolves quarter windows onto their first and last month', () => {
    expect(resolveExpectedWindow('2026-Q1')).toMatchObject({ startDay: '2026-01-01', endDay: '2026-03-31' });
    expect(resolveExpectedWindow('2026-Q2')).toMatchObject({ startDay: '2026-04-01', endDay: '2026-06-30' });
    expect(resolveExpectedWindow('2026-Q3')).toMatchObject({ startDay: '2026-07-01', endDay: '2026-09-30' });
    expect(resolveExpectedWindow('2026-Q4')).toMatchObject({ startDay: '2026-10-01', endDay: '2026-12-31' });
  });

  it('resolves a leap February exactly', () => {
    expect(resolveExpectedWindow('2028-02').endDay).toBe('2028-02-29');
    expect(resolveExpectedWindow('2027-02').endDay).toBe('2027-02-28');
  });

  it('rejects malformed window shapes, naming the valid shapes', () => {
    for (const bad of ['2026-13', '2026-00', '2026-Q5', '2026-Q0', '2026-3', '2026', '2026-09-01', '']) {
      expect(() => resolveExpectedWindow(bad)).toThrow(/YYYY-MM.*YYYY-Qn|valid shapes/s);
    }
  });
});

describe('resolvePeriodStart / resolveWindowEnd', () => {
  it('CONFIRMED period start is the exact occurrence date; no window end', () => {
    const confirmed = event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-08-06' });
    expect(resolvePeriodStart(confirmed)).toBe('2026-08-06');
    expect(resolveWindowEnd(confirmed)).toBeNull();
  });

  it('EXPECTED period start is the window’s first day; window end is its last day', () => {
    const monthWindow = event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-03' });
    const quarterWindow = event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' });

    expect(resolvePeriodStart(monthWindow)).toBe('2026-03-01');
    expect(resolveWindowEnd(monthWindow)).toBe('2026-03-31');
    expect(resolvePeriodStart(quarterWindow)).toBe('2026-10-01');
    expect(resolveWindowEnd(quarterWindow)).toBe('2026-12-31');
  });

  it('a CONFIRMED row with a malformed or missing date fails loudly instead of corrupting the order', () => {
    const broken = event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-02-30' });
    expect(() => resolvePeriodStart(broken)).toThrow(InvalidCalendarInputError);

    const nullDate = event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: null });
    expect(() => resolvePeriodStart(nullDate)).toThrow(InvalidCalendarInputError);
  });
});

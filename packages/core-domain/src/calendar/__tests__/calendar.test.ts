/**
 * Unit tests for the pure calendar service (spec: tax-change-calendar,
 * task 2.1): next-event selection (nearest period wins, CONFIRMED day
 * precision beats an EXPECTED window in the same period, in-progress
 * windows stay upcoming until their end), the versioned rhythm
 * disclaimer pair (selected by explicit language, default `fi`, free of
 * forecast wording), and the caller-contract validation.
 *
 * Pure functions — no DB, no mocks, no clock: every "today" in these
 * tests is an explicit `fromDate` argument.
 */
import { describe, expect, it } from 'vitest';

import { findNextCalendarEvent } from '../calendar';
import {
  CALENDAR_RHYTHM_DISCLAIMER_EN,
  CALENDAR_RHYTHM_DISCLAIMER_FI,
  selectRhythmDisclaimer,
} from '../calendar.disclaimer';
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  InvalidCalendarInputError,
  type CalendarEvent,
} from '../calendar.types';

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

function verifiedSet2026(): CalendarEvent[] {
  return [
    event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' }),
    event({ eventType: 'EE_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01' }),
    event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-03' }),
    event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-08-06' }),
    event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-09' }),
    event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' }),
  ];
}

// ---------------------------------------------------------------------------
// Next-event selection — the documented rule
// ---------------------------------------------------------------------------

describe('findNextCalendarEvent — precedence', () => {
  it('a CONFIRMED exact date beats an EXPECTED window sharing the same period start', () => {
    // Two rows on the quarter boundary 2026-10-01: the dated fact is the
    // stronger event and must win the tie.
    const events = [
      event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' }),
      event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-10-01' }),
    ];

    const next = findNextCalendarEvent(events, '2026-09-01');

    expect(next?.event.status).toBe('CONFIRMED');
    expect(next?.event.eventType).toBe('TAX_TABLE_PUBLICATION');
    expect(next?.daysUntil).toBe(30); // 2026-09-01 → 2026-10-01
  });

  it('the nearest period wins regardless of status', () => {
    const next = findNextCalendarEvent(verifiedSet2026(), '2026-06-15');

    expect(next?.event.eventType).toBe('TAX_TABLE_PUBLICATION');
    expect(next?.event.status).toBe('CONFIRMED');
    expect(next?.daysUntil).toBe(52); // 2026-06-15 → 2026-08-06
  });

  it('windows whose start has passed stay upcoming while the window runs (month window)', () => {
    // 2026-09-20: the autumn Alko window started 09-01 (gone) but ends
    // 09-30 (not) — the rhythm is current and must still be returned.
    const next = findNextCalendarEvent(verifiedSet2026(), '2026-09-20');

    expect(next?.event.eventType).toBe('ALKO_PRICE_LIST');
    expect(next?.event.expectedWindow).toBe('2026-09');
    // A window event never carries a countdown — no day figure is invented.
    expect(next?.daysUntil).toBeNull();
  });

  it('quarter windows behave the same: current through the quarter’s last day, gone the day after', () => {
    const events = [event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' })];

    expect(findNextCalendarEvent(events, '2026-12-31')?.event.id).toBe(events[0].id);
    expect(findNextCalendarEvent(events, '2027-01-01')).toBeNull();
  });

  it('a month window is gone the day after its end', () => {
    const events = verifiedSet2026();

    // 2026-09-30 (the window's last day): the autumn window is still next —
    // its start (09-01) precedes the Q4 window's start (10-01).
    expect(findNextCalendarEvent(events, '2026-09-30')?.event.expectedWindow).toBe('2026-09');

    // 2026-10-01: the month window has ended; the Q4 window is next.
    const next = findNextCalendarEvent(events, '2026-10-01');
    expect(next?.event.eventType).toBe('RATE_DECISION');
    expect(next?.daysUntil).toBeNull();
  });

  it('CONFIRMED events before fromDate are excluded; the one on fromDate is included with daysUntil 0', () => {
    const events = [
      event({ eventType: 'TAX_TABLE_PUBLICATION', status: 'CONFIRMED', occurrenceDate: '2026-08-06' }),
    ];

    expect(findNextCalendarEvent(events, '2026-08-07')).toBeNull();
    expect(findNextCalendarEvent(events, '2026-08-06')).toEqual({ event: events[0], daysUntil: 0 });
  });

  it('returns null when nothing is upcoming — the caller degrades, the module invents no fallback', () => {
    expect(findNextCalendarEvent(verifiedSet2026(), '2027-01-01')).toBeNull();
    expect(findNextCalendarEvent([], '2026-01-01')).toBeNull();
  });

  it('is deterministic: same rows and fromDate, same result across runs and input orders', () => {
    const events = verifiedSet2026();
    const first = JSON.stringify(findNextCalendarEvent(events, '2026-06-15'));
    const second = JSON.stringify(findNextCalendarEvent([...events].reverse(), '2026-06-15'));

    expect(second).toBe(first);
  });

  it('never mutates its input', () => {
    const input = verifiedSet2026();
    const snapshot = [...input];

    findNextCalendarEvent(input, '2026-06-15');

    expect(input).toEqual(snapshot);
  });

  it('validates every provided row before selecting — a malformed row fails loudly even when it would not win', () => {
    const events = [
      ...verifiedSet2026(),
      // A confirmed row claiming an impossible day, far after the true
      // next event — silently tolerated it would corrupt the comparator.
      event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2027-02-30' }),
    ];

    expect(() => findNextCalendarEvent(events, '2026-06-15')).toThrow(InvalidCalendarInputError);
  });
});

// ---------------------------------------------------------------------------
// Caller-contract validation
// ---------------------------------------------------------------------------

describe('findNextCalendarEvent — validation', () => {
  it('rejects an event type outside the closed set, naming the valid types', () => {
    const events = [
      event({ eventType: 'VOLCANO' as CalendarEvent['eventType'], status: 'CONFIRMED', occurrenceDate: '2026-05-01' }),
    ];

    try {
      findNextCalendarEvent(events, '2026-01-01');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      for (const valid of CALENDAR_EVENT_TYPES) {
        expect((error as Error).message).toContain(valid);
      }
    }
  });

  it('rejects a status outside the closed set, naming the valid statuses', () => {
    const events = [
      event({ eventType: 'RATE_DECISION', status: 'MAYBE' as CalendarEvent['status'], occurrenceDate: null }),
    ];

    try {
      findNextCalendarEvent(events, '2026-01-01');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCalendarInputError);
      for (const valid of CALENDAR_EVENT_STATUSES) {
        expect((error as Error).message).toContain(valid);
      }
    }
  });

  it('enforces the precision split in both directions', () => {
    // CONFIRMED must not carry a window…
    const windowedConfirmed = event({
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: '2026-01',
    });
    expect(() => findNextCalendarEvent([windowedConfirmed], '2026-01-01')).toThrow(
      /CONFIRMED event must not carry an expected window/,
    );

    // …and must carry an exact date.
    const datelessConfirmed = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED' });
    expect(() => findNextCalendarEvent([datelessConfirmed], '2026-01-01')).toThrow(InvalidCalendarInputError);

    // EXPECTED must not claim day precision…
    const datedExpected = event({
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: '2026-03-15',
      expectedWindow: '2026-03',
    });
    expect(() => findNextCalendarEvent([datedExpected], '2026-01-01')).toThrow(
      /EXPECTED event must not carry an exact occurrence date/,
    );

    // …and must carry a window.
    const windowlessExpected = event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED' });
    expect(() => findNextCalendarEvent([windowlessExpected], '2026-01-01')).toThrow(InvalidCalendarInputError);
  });

  it('rejects impossible calendar days and malformed window shapes', () => {
    const impossibleDay = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-02-30' });
    expect(() => findNextCalendarEvent([impossibleDay], '2026-01-01')).toThrow(/real calendar day/);

    const shortDate = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-1-1' });
    expect(() => findNextCalendarEvent([shortDate], '2026-01-01')).toThrow(/YYYY-MM-DD/);

    const badMonth = event({ eventType: 'ALKO_PRICE_LIST', status: 'EXPECTED', expectedWindow: '2026-13' });
    expect(() => findNextCalendarEvent([badMonth], '2026-01-01')).toThrow(/valid shapes/);

    const badQuarter = event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q5' });
    expect(() => findNextCalendarEvent([badQuarter], '2026-01-01')).toThrow(/valid shapes/);
  });

  it('rejects missing locale text or source URL — no hole mid-timeline, no unsourced row', () => {
    for (const blank of ['titleFi', 'titleEn', 'summaryFi', 'summaryEn', 'sourceUrl'] as const) {
      const base = event({ eventType: 'RATE_DECISION', status: 'EXPECTED', expectedWindow: '2026-Q4' });
      const events: CalendarEvent[] = [{ ...base, ...({ [blank]: '' } as Partial<CalendarEvent>) }];

      try {
        findNextCalendarEvent(events, '2026-01-01');
        expect.unreachable(`${blank} must be required`);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidCalendarInputError);
        expect((error as Error).message).toContain(blank);
      }
    }
  });

  it('rejects non-integer ids and years', () => {
    const badId = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01', id: 1.5 });
    expect(() => findNextCalendarEvent([badId], '2026-01-01')).toThrow(/id must be an integer/);

    const badYear = event({ eventType: 'FI_EXCISE_CHANGE', status: 'CONFIRMED', occurrenceDate: '2026-01-01', year: 2026.5 });
    expect(() => findNextCalendarEvent([badYear], '2026-01-01')).toThrow(/year must be an integer/);
  });

  it('requires an explicit ISO fromDate — no clock is read, no other shape is parsed', () => {
    for (const bad of ['2026-10-15T00:00:00Z', '15.10.2026', '2026-10', '', '2026-02-30']) {
      expect(() => findNextCalendarEvent(verifiedSet2026(), bad)).toThrow(InvalidCalendarInputError);
    }
  });
});

// ---------------------------------------------------------------------------
// Structural rhythm disclaimer — versioned pair, explicit language
// ---------------------------------------------------------------------------

describe('selectRhythmDisclaimer', () => {
  it('selects the Finnish constant for an explicit "fi"', () => {
    expect(selectRhythmDisclaimer('fi')).toBe(CALENDAR_RHYTHM_DISCLAIMER_FI);
    expect(selectRhythmDisclaimer('fi').language).toBe('fi');
  });

  it('selects the English constant for an explicit "en"', () => {
    expect(selectRhythmDisclaimer('en')).toBe(CALENDAR_RHYTHM_DISCLAIMER_EN);
    expect(selectRhythmDisclaimer('en').language).toBe('en');
  });

  it('defaults to Finnish when the language is absent', () => {
    expect(selectRhythmDisclaimer()).toBe(CALENDAR_RHYTHM_DISCLAIMER_FI);
    expect(selectRhythmDisclaimer().language).toBe('fi');
  });

  it('both constants are versioned and carry their own language', () => {
    for (const disclaimer of [CALENDAR_RHYTHM_DISCLAIMER_FI, CALENDAR_RHYTHM_DISCLAIMER_EN]) {
      expect(disclaimer.version).toBe('1.0');
      expect(disclaimer.text.trim().length).toBeGreaterThan(0);
    }
    expect(CALENDAR_RHYTHM_DISCLAIMER_FI.language).toBe('fi');
    expect(CALENDAR_RHYTHM_DISCLAIMER_EN.language).toBe('en');
  });

  it('states the recurring rhythm and that the note is not an official announcement', () => {
    expect(CALENDAR_RHYTHM_DISCLAIMER_FI.text).toContain('Vuosirytmi');
    expect(CALENDAR_RHYTHM_DISCLAIMER_FI.text).toContain('toistuvat vuosittain');
    expect(CALENDAR_RHYTHM_DISCLAIMER_FI.text).toContain('ei ole virallinen ilmoitus');

    expect(CALENDAR_RHYTHM_DISCLAIMER_EN.text).toContain('Annual rhythm');
    expect(CALENDAR_RHYTHM_DISCLAIMER_EN.text).toContain('recur each year');
    expect(CALENDAR_RHYTHM_DISCLAIMER_EN.text).toContain('not an official announcement');
  });

  it('contains no forecast-rooted words in either language', () => {
    // The wording describes the publication rhythm only — no prediction
    // vocabulary at all (stronger than negated forecast wording: the
    // rhythm note never speaks of prediction, so no root may appear).
    const forecastRootsFi = ['ennust', 'arvio', 'odot', 'tuleva', 'veikka', 'ehkä'];
    const forecastRootsEn = [
      'forecast',
      'predict',
      'project',
      'estimat',
      'expect',
      'anticipat',
      'speculat',
      'futur',
    ];

    for (const root of forecastRootsFi) {
      expect(CALENDAR_RHYTHM_DISCLAIMER_FI.text.toLowerCase()).not.toContain(root);
    }
    for (const root of forecastRootsEn) {
      expect(CALENDAR_RHYTHM_DISCLAIMER_EN.text.toLowerCase()).not.toContain(root);
      expect(CALENDAR_RHYTHM_DISCLAIMER_FI.text.toLowerCase()).not.toContain(root);
    }
  });
});

/**
 * Persistence-boundary validation for `calendar_events` (task 1.2,
 * change tax-change-calendar). Pure unit tests: every rejection the
 * spec's persistence-boundary clause demands — unknown event type,
 * unknown status, missing source URL, missing locale text, and the
 * status/precision coupling (CONFIRMED ⇄ occurrence_date, EXPECTED ⇄
 * expected_window) — plus the CONFIRMED and EXPECTED happy paths with
 * their narrowed insert shapes.
 *
 * @module CalendarEventValidatorTest
 */
import { describe, it, expect } from 'vitest';
import {
  validateCalendarEvent,
  type CalendarEventInput,
} from '../calendar-event-validator';
import { CALENDAR_EVENT_TYPES, CALENDAR_EVENT_STATUSES } from '../../d1/schema';

function confirmedInput(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    year: 2026,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    titleFi: 'Alkoholijuomien valmistevero nousi',
    titleEn: 'Finnish alcohol excise rose',
    summaryFi: 'Viini ja siideri kallistuivat noin yhdeksän prosenttia.',
    summaryEn: 'Wine and cider became about nine percent more expensive.',
    sourceUrl: 'https://vero.fi/artikkeli/valmisteverot-2026',
    ...overrides,
  };
}

function expectedInput(overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return confirmedInput({
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-09',
    ...overrides,
  });
}

describe('validateCalendarEvent — happy paths', () => {
  it('accepts a CONFIRMED event and narrows it to the dated-fact shape', () => {
    const event = validateCalendarEvent(confirmedInput());
    expect(event).toEqual({
      year: 2026,
      eventType: 'FI_EXCISE_CHANGE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-01-01',
      expectedWindow: null,
      titleFi: 'Alkoholijuomien valmistevero nousi',
      titleEn: 'Finnish alcohol excise rose',
      summaryFi: 'Viini ja siideri kallistuivat noin yhdeksän prosenttia.',
      summaryEn: 'Wine and cider became about nine percent more expensive.',
      sourceUrl: 'https://vero.fi/artikkeli/valmisteverot-2026',
    });
  });

  it('accepts an EXPECTED event with a month window', () => {
    const event = validateCalendarEvent(expectedInput());
    expect(event.status).toBe('EXPECTED');
    expect(event.occurrenceDate).toBeNull();
    expect(event.expectedWindow).toBe('2026-09');
  });

  it('accepts every closed event-type value and a quarter window', () => {
    CALENDAR_EVENT_TYPES.forEach((eventType) => {
      expect(() =>
        validateCalendarEvent(expectedInput({ eventType, expectedWindow: '2027-Q4' })),
      ).not.toThrow();
    });
  });
});

describe('validateCalendarEvent — closed-vocabulary rejections', () => {
  it('rejects an unknown event type naming the valid types', () => {
    expect(() => validateCalendarEvent(confirmedInput({ eventType: 'ALKO_SALE' }))).toThrow(
      /calendar_events\.event_type "ALKO_SALE" is not a known calendar event type — valid types: FI_EXCISE_CHANGE, EE_EXCISE_CHANGE, ALKO_PRICE_LIST, TAX_TABLE_PUBLICATION, RATE_DECISION/,
    );
  });

  it('rejects an unknown status naming the valid statuses', () => {
    expect(() => validateCalendarEvent(confirmedInput({ status: 'PREDICTED' }))).toThrow(
      /calendar_events\.status "PREDICTED" is not a known calendar event status — valid statuses: CONFIRMED, EXPECTED/,
    );
    CALENDAR_EVENT_STATUSES.forEach((status) => {
      const input = status === 'CONFIRMED' ? confirmedInput() : expectedInput();
      expect(() => validateCalendarEvent(input)).not.toThrow();
    });
  });
});

describe('validateCalendarEvent — sourcing and locale rejections', () => {
  it('rejects a missing source URL', () => {
    expect(() => validateCalendarEvent(confirmedInput({ sourceUrl: '' }))).toThrow(
      /calendar_events\.source_url is required — every calendar event cites its official source/,
    );
    expect(() => validateCalendarEvent(confirmedInput({ sourceUrl: '   ' }))).toThrow(
      /source_url is required/,
    );
  });

  it('rejects a source URL that is not an absolute http(s) URL', () => {
    expect(() =>
      validateCalendarEvent(confirmedInput({ sourceUrl: 'vero.fi/artikkeli' })),
    ).toThrow(/is not an absolute URL/);
    expect(() =>
      validateCalendarEvent(confirmedInput({ sourceUrl: 'javascript:alert(1)' })),
    ).toThrow(/must be an http\(s\) URL/);
  });

  it('rejects each missing locale text naming its column', () => {
    const columns = [
      'titleFi',
      'titleEn',
      'summaryFi',
      'summaryEn',
    ] as const;
    const dbColumns: Record<(typeof columns)[number], string> = {
      titleFi: 'title_fi',
      titleEn: 'title_en',
      summaryFi: 'summary_fi',
      summaryEn: 'summary_en',
    };
    columns.forEach((column) => {
      expect(() => validateCalendarEvent(confirmedInput({ [column]: '' }))).toThrow(
        new RegExp(
          `calendar_events\\.${dbColumns[column]} is required — every calendar event carries FI and EN title and summary text`,
        ),
      );
      expect(() =>
        validateCalendarEvent(confirmedInput({ [column]: '   ' })),
      ).toThrow(new RegExp(`calendar_events\\.${dbColumns[column]} is required`));
    });
  });
});

describe('validateCalendarEvent — status/precision coupling', () => {
  it('rejects CONFIRMED without occurrenceDate', () => {
    expect(() =>
      validateCalendarEvent(confirmedInput({ occurrenceDate: null })),
    ).toThrow(
      /calendar_events\.status CONFIRMED requires occurrence_date — a confirmed event is an exact dated fact \(YYYY-MM-DD\); window-shaped rows are EXPECTED/,
    );
  });

  it('rejects CONFIRMED with an expectedWindow', () => {
    expect(() =>
      validateCalendarEvent(confirmedInput({ expectedWindow: '2026-Q1' })),
    ).toThrow(/calendar_events\.status CONFIRMED forbids expected_window/);
  });

  it('rejects EXPECTED with an occurrenceDate', () => {
    expect(() =>
      validateCalendarEvent(expectedInput({ occurrenceDate: '2026-09-01' })),
    ).toThrow(
      /calendar_events\.status EXPECTED forbids occurrence_date — an expected window event must not claim day precision; dated facts are CONFIRMED/,
    );
  });

  it('rejects EXPECTED without an expectedWindow', () => {
    expect(() => validateCalendarEvent(expectedInput({ expectedWindow: null }))).toThrow(
      /calendar_events\.status EXPECTED requires expected_window with month or quarter precision — valid shapes: YYYY-MM \(e\.g\. 2026-09\) or YYYY-Qn \(e\.g\. 2027-Q4\)/,
    );
  });

  it('rejects an expectedWindow outside month-or-quarter precision', () => {
    ['2026', '2026-W41', '2026-13', '2026-Q5', 'September'].forEach((window) => {
      expect(() =>
        validateCalendarEvent(expectedInput({ expectedWindow: window })),
      ).toThrow(/requires expected_window with month or quarter precision/);
    });
  });
});

describe('validateCalendarEvent — date integrity', () => {
  it('rejects an occurrenceDate outside YYYY-MM-DD shape or not a real date', () => {
    ['2026-1-1', '01.01.2026', '2026-13-01', '2026-02-30'].forEach((date) => {
      expect(() => validateCalendarEvent(confirmedInput({ occurrenceDate: date }))).toThrow(
        /must be a real calendar date in YYYY-MM-DD shape/,
      );
    });
  });

  it('rejects a non-integer year', () => {
    expect(() => validateCalendarEvent(confirmedInput({ year: 2026.5 }))).toThrow(
      /calendar_events\.year 2026\.5 is not an integer calendar year/,
    );
    expect(() =>
      validateCalendarEvent(confirmedInput({ year: undefined as unknown as number })),
    ).toThrow(/is not an integer calendar year/);
  });
});

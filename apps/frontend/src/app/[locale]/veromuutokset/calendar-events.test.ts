/**
 * Pure grouping/normalization tests for the tax-change calendar page
 * (task 4.1). The fixtures mirror the 2026 seed rows' period shapes —
 * the same status/precision split the persistence boundary enforces.
 */
import { describe, expect, it } from 'vitest';
import {
  groupCalendarEvents,
  isCalendarDisclaimer,
  resolveCalendarYear,
  type CalendarEventDto,
} from './calendar-events';

function event(overrides: Partial<CalendarEventDto>): CalendarEventDto {
  return {
    id: 1,
    year: 2026,
    eventType: 'FI_EXCISE_CHANGE',
    status: 'CONFIRMED',
    occurrenceDate: '2026-01-01',
    expectedWindow: null,
    titleFi: 'Otsikko',
    titleEn: 'Title',
    summaryFi: 'Yhteenveto',
    summaryEn: 'Summary',
    sourceUrl: 'https://www.vero.fi/valmisteverot',
    ...overrides,
  };
}

/** The six seeded 2026 rows, in the API's deterministic order. */
const SEEDED_2026: readonly CalendarEventDto[] = [
  event({ id: 1, eventType: 'FI_EXCISE_CHANGE' }), // CONFIRMED 2026-01-01
  event({ id: 2, eventType: 'EE_EXCISE_CHANGE' }), // CONFIRMED 2026-01-01
  event({
    id: 3,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-03',
  }),
  event({
    id: 4,
    eventType: 'ALKO_PRICE_LIST',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-09',
  }),
  event({
    id: 5,
    eventType: 'TAX_TABLE_PUBLICATION',
    occurrenceDate: '2026-08-06',
  }),
  event({
    id: 6,
    eventType: 'RATE_DECISION',
    status: 'EXPECTED',
    occurrenceDate: null,
    expectedWindow: '2026-Q4',
  }),
];

describe('resolveCalendarYear', () => {
  it('passes an in-bounds integer year through', () => {
    expect(resolveCalendarYear('2025', 2026)).toBe(2025);
    expect(resolveCalendarYear(undefined, 2026)).toBe(2026);
  });

  it('falls back to the current year on junk, empty, and out-of-bounds values', () => {
    expect(resolveCalendarYear('abcd', 2026)).toBe(2026);
    expect(resolveCalendarYear('', 2026)).toBe(2026);
    expect(resolveCalendarYear('1999', 2026)).toBe(2026);
    expect(resolveCalendarYear('2101', 2026)).toBe(2026);
    expect(resolveCalendarYear('2026.5', 2026)).toBe(2026);
    expect(resolveCalendarYear(['2030', '2025'], 2026)).toBe(2030);
  });
});

describe('isCalendarDisclaimer', () => {
  it('accepts the versioned object the routes serialize', () => {
    expect(
      isCalendarDisclaimer({
        text: 'Vuosirytmi: merkintä kuvaa julkaisuaikataulua.',
        language: 'fi',
        version: '1.0',
      }),
    ).toBe(true);
  });

  it('rejects a bare string, null, and non-objects (the pre-fix payload shapes)', () => {
    expect(isCalendarDisclaimer('Vuosirytmi: …')).toBe(false);
    expect(isCalendarDisclaimer(null)).toBe(false);
    expect(isCalendarDisclaimer(undefined)).toBe(false);
    expect(isCalendarDisclaimer(42)).toBe(false);
    expect(isCalendarDisclaimer(['Vuosirytmi: …'])).toBe(false);
  });

  it('rejects objects violating the honesty contract\'s field requirements', () => {
    const valid = { text: 'Vuosirytmi: …', language: 'fi', version: '1.0' };
    expect(isCalendarDisclaimer({ ...valid, text: '' })).toBe(false);
    expect(isCalendarDisclaimer({ ...valid, language: '' })).toBe(false);
    expect(isCalendarDisclaimer({ ...valid, version: '' })).toBe(false);
    expect(
      isCalendarDisclaimer({ text: 'Vuosirytmi: …', language: 'fi' }),
    ).toBe(false);
    expect(isCalendarDisclaimer({ ...valid, text: 7 })).toBe(false);
  });
});

describe('groupCalendarEvents', () => {
  it('groups the 2026 seeded set into four ordered month/quarter groups', () => {
    const groups = groupCalendarEvents(SEEDED_2026, 'fi');

    expect(groups.map((group) => group.key)).toEqual([
      '2026-01',
      '2026-03',
      '2026-08',
      '2026-09',
      '2026-Q4',
    ]);
    // January holds both confirmed New-Year changes in API order.
    expect(groups[0].events.map((event) => event.id)).toEqual([1, 2]);
    // Groups carry the marker only when every event is EXPECTED.
    expect(groups.map((group) => group.isExpected)).toEqual([
      false,
      true,
      false,
      true,
      true,
    ]);
  });

  it('labels months per locale: capitalized Finnish, English long month', () => {
    const fi = groupCalendarEvents(SEEDED_2026, 'fi');
    expect(fi.map((group) => group.label)).toEqual([
      'Tammikuu 2026',
      'Maaliskuu 2026',
      'Elokuu 2026',
      'Syyskuu 2026',
      'Q4 2026',
    ]);

    const en = groupCalendarEvents(SEEDED_2026, 'en');
    expect(en.map((group) => group.label)).toEqual([
      'January 2026',
      'March 2026',
      'August 2026',
      'September 2026',
      'Q4 2026',
    ]);
  });

  it('orders groups by period start, quarter window at its first month', () => {
    const groups = groupCalendarEvents(
      [
        event({ id: 6, expectedWindow: '2026-Q4', status: 'EXPECTED', occurrenceDate: null }),
        event({ id: 5, occurrenceDate: '2026-11-02' }),
        event({ id: 7, occurrenceDate: '2026-10-31' }),
      ],
      'fi',
    );
    // Period-start order (the domain comparator's key): the Q4 window
    // opens 2026-10-01, so it sits right after the dated October group —
    // and, on the equal start, AFTER it (confirmed beats expected, the
    // next-event rule).
    expect(groups.map((group) => group.key)).toEqual([
      '2026-10',
      '2026-Q4',
      '2026-11',
    ]);
  });

  it('keeps the API order inside one group (deterministic, no re-sort)', () => {
    const groups = groupCalendarEvents(
      [
        event({ id: 9, occurrenceDate: '2026-05-20' }),
        event({ id: 8, occurrenceDate: '2026-05-02' }),
      ],
      'en',
    );
    // The API's order (period → type → id) stands: 9 before 8.
    expect(groups[0].events.map((event) => event.id)).toEqual([9, 8]);
  });

  it('keeps a contract-violating row visible under a trailing raw group', () => {
    const groups = groupCalendarEvents(
      [
        event({ id: 1 }),
        // CONFIRMED without a date — impossible through the persistence
        // boundary, but the timeline must not crash or lose the row.
        event({ id: 99, status: 'CONFIRMED', occurrenceDate: null }),
      ],
      'fi',
    );
    expect(groups).toHaveLength(2);
    expect(groups[1].key).toBe('raw-99');
    expect(groups[1].label).toBe('#99');
  });
});

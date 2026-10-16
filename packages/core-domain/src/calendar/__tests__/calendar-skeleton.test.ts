/**
 * Unit tests for the pure Alko skeleton generator (spec: calendar-
 * event-automation, "Automatic rhythm-skeleton generation", task 2.1):
 * the two EXPECTED month-window rows (YYYY-03 / YYYY-09), the versioned
 * FI/EN text constants, the official rhythm source, all-or-nothing
 * idempotence per year, and the never-CONFIRMED invariant.
 *
 * Pure functions — no DB, no mocks, no clock: coverage is expressed as
 * plain (year, eventType) rows, exactly what the task-3.1 cron will
 * read from the repository.
 */
import { describe, expect, it } from 'vitest';

import {
  ALKO_RHYTHM_SOURCE_URL,
  CALENDAR_SKELETON_TEXT_EN,
  CALENDAR_SKELETON_TEXT_FI,
  generateAlkoSkeleton,
  type AlkoSkeletonEvent,
} from '../calendar.skeleton';
import {
  CALENDAR_EVENT_TYPES,
  InvalidCalendarInputError,
  type CalendarEvent,
} from '../calendar.types';
import { assertValidCalendarEvent } from '../calendar';
import { resolveExpectedWindow } from '../ordering';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A coverage row — only the fields the skip rule reads. */
function existing(year: number, eventType: CalendarEvent['eventType']): { year: number; eventType: CalendarEvent['eventType'] } {
  return { year, eventType };
}

const ALKO = 'ALKO_PRICE_LIST' as const;

// ---------------------------------------------------------------------------
// Shape — the two rhythm rows
// ---------------------------------------------------------------------------

describe('generateAlkoSkeleton — generated rows', () => {
  it('emits exactly two ALKO_PRICE_LIST EXPECTED rows for a fresh year, spring (03) before autumn (09)', () => {
    const rows = generateAlkoSkeleton(2027, []);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.eventType).toBe('ALKO_PRICE_LIST');
      expect(row.status).toBe('EXPECTED');
      expect(row.year).toBe(2027);
    }
    expect(rows.map((row) => row.expectedWindow)).toEqual(['2027-03', '2027-09']);
  });

  it('windows are month-shaped YYYY-MM and parse as real windows — never a day, never a quarter', () => {
    const rows = generateAlkoSkeleton(2028, []);

    for (const row of rows) {
      expect(row.occurrenceDate).toBeNull();
      expect(row.expectedWindow).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
      // The module's own window parser accepts the shape (and would
      // reject anything else) — the generated rows are valid windows.
      expect(() => resolveExpectedWindow(row.expectedWindow as string)).not.toThrow();
      expect(resolveExpectedWindow(row.expectedWindow as string).year).toBe(2028);
    }
  });

  it('no generated row is ever CONFIRMED — the invariant holds across years', () => {
    for (const year of [2027, 2030, 9999]) {
      for (const row of generateAlkoSkeleton(year, [])) {
        expect(row.status).not.toBe('CONFIRMED');
        expect(row.status).toBe('EXPECTED');
      }
    }
  });

  it('both rows cite the official Alko rhythm statement as their source', () => {
    const rows = generateAlkoSkeleton(2027, []);

    for (const row of rows) {
      expect(row.sourceUrl).toBe(ALKO_RHYTHM_SOURCE_URL);
    }
    expect(ALKO_RHYTHM_SOURCE_URL).toMatch(/^https:\/\/www\.alko\.fi\//);
  });

  it('generated rows satisfy the calendar event contract once the repository assigns an id', () => {
    let id = 900;
    for (const year of [2027, 2028]) {
      for (const row of generateAlkoSkeleton(year, [])) {
        const event: CalendarEvent = { id: id++, ...row };
        expect(() => assertValidCalendarEvent(event)).not.toThrow();
      }
    }
  });

  it('never mutates its input', () => {
    const existingEvents = [existing(2026, ALKO), existing(2026, 'FI_EXCISE_CHANGE')];
    const snapshot = [...existingEvents];

    generateAlkoSkeleton(2027, existingEvents);

    expect(existingEvents).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Versioned text constants — FI/EN pair, {year} substitution
// ---------------------------------------------------------------------------

describe('calendar skeleton text constants', () => {
  it('both constants are versioned and carry their own language', () => {
    for (const text of [CALENDAR_SKELETON_TEXT_FI, CALENDAR_SKELETON_TEXT_EN]) {
      expect(text.version).toBe('1.0');
      expect(text.titles.spring.trim().length).toBeGreaterThan(0);
      expect(text.titles.autumn.trim().length).toBeGreaterThan(0);
      expect(text.summaries.spring.trim().length).toBeGreaterThan(0);
      expect(text.summaries.autumn.trim().length).toBeGreaterThan(0);
    }
    expect(CALENDAR_SKELETON_TEXT_FI.language).toBe('fi');
    expect(CALENDAR_SKELETON_TEXT_EN.language).toBe('en');
  });

  it('summaries carry the {year} placeholder — and generated rows render it', () => {
    expect(CALENDAR_SKELETON_TEXT_FI.summaries.spring).toContain('{year}');
    expect(CALENDAR_SKELETON_TEXT_FI.summaries.autumn).toContain('{year}');
    expect(CALENDAR_SKELETON_TEXT_EN.summaries.spring).toContain('{year}');
    expect(CALENDAR_SKELETON_TEXT_EN.summaries.autumn).toContain('{year}');

    const rows = generateAlkoSkeleton(2027, []);
    for (const row of rows) {
      expect(row.summaryFi).not.toContain('{year}');
      expect(row.summaryEn).not.toContain('{year}');
      expect(row.summaryFi).toContain('2027');
      expect(row.summaryEn).toContain('2027');
    }
  });

  it('the wording describes the rhythm and never announces a change', () => {
    // Rhythm is stated in both languages…
    expect(CALENDAR_SKELETON_TEXT_FI.summaries.spring).toContain('kaksi kertaa vuodessa');
    expect(CALENDAR_SKELETON_TEXT_EN.summaries.spring).toContain('twice a year');
    // …and the note states no dated announcement exists (it waits for
    // confirmation — it does not announce a change).
    expect(CALENDAR_SKELETON_TEXT_FI.summaries.spring).toContain('ei ole vielä julkaistua päivämäärää');
    expect(CALENDAR_SKELETON_TEXT_EN.summaries.spring).toContain('No dated announcement exists yet');

    // No generated text carries a full date — a rhythm row must not
    // claim day precision anywhere in its wording.
    const rows = generateAlkoSkeleton(2027, []);
    for (const row of rows) {
      for (const value of [row.titleFi, row.titleEn, row.summaryFi, row.summaryEn]) {
        expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it('the generated 2026 texts match the committed seed pair byte for byte', () => {
    // The seed (data-platform, task 1.3 of tax-change-calendar) is the
    // hand-verified precedent; the constants must reproduce it so a
    // future re-skeleton never drifts from the verified wording.
    const rows = generateAlkoSkeleton(2026, []);

    expect(rows[0].titleFi).toBe('Alkon kevään jaksovaihto (odotettu maaliskuun lopussa)');
    expect(rows[0].titleEn).toBe('Alko spring price-list change (expected late March)');
    expect(rows[0].summaryFi).toBe(
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. ' +
        'Kevään 2026 jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
    );
    expect(rows[0].summaryEn).toBe(
      'Alko changes its retail prices twice a year, normally at the end of March and September. ' +
        'No dated announcement exists yet for the spring 2026 switch, so the event is listed as expected.',
    );
    expect(rows[1].titleFi).toBe('Alkon syksyn jaksovaihto (odotettu syyskuun lopussa)');
    expect(rows[1].titleEn).toBe('Alko autumn price-list change (expected late September)');
    expect(rows[1].summaryFi).toBe(
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. ' +
        'Syksyn 2026 jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
    );
    expect(rows[1].summaryEn).toBe(
      'Alko changes its retail prices twice a year, normally at the end of March and September. ' +
        'No dated announcement exists yet for the autumn 2026 switch, so the event is listed as expected.',
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotence — all-or-nothing per year
// ---------------------------------------------------------------------------

describe('generateAlkoSkeleton — idempotence and the year-skip rule', () => {
  it('is deterministic: two runs over the same state produce identical rows', () => {
    const first = generateAlkoSkeleton(2027, []);
    const second = generateAlkoSkeleton(2027, []);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('a second run after the first run inserted yields nothing (spec: rerun does not duplicate)', () => {
    const firstRun = generateAlkoSkeleton(2027, []);

    // Simulate the repository insert: the first run's rows now exist…
    const stored = firstRun.map((row, index) => ({ id: 100 + index, ...row }));

    // …and the second run sees them.
    const secondRun = generateAlkoSkeleton(2027, stored);
    expect(secondRun).toEqual([]);
  });

  it('skips the whole year when EITHER window row already exists (all-or-nothing)', () => {
    // Only the March row exists (September somehow missing)…
    const marchOnly = [existing(2027, ALKO)];
    expect(generateAlkoSkeleton(2027, marchOnly)).toEqual([]);

    // …only the September row exists…
    const septemberOnly = [{ year: 2027, eventType: ALKO }];
    expect(generateAlkoSkeleton(2027, septemberOnly)).toEqual([]);

    // …and a CONFIRMED upgrade by the operator covers just as well.
    const confirmed = generateAlkoSkeleton(2028, []).map((row, index) => ({
      id: 200 + index,
      ...row,
      status: 'CONFIRMED' as const,
      occurrenceDate: '2028-03-25',
      expectedWindow: null,
    }));
    expect(generateAlkoSkeleton(2028, confirmed)).toEqual([]);
  });

  it('coverage is per year: other years’ Alko rows never block the target year', () => {
    const existingEvents = [
      ...generateAlkoSkeleton(2026, []).map((row, index) => ({ id: 300 + index, ...row })),
      ...generateAlkoSkeleton(2028, []).map((row, index) => ({ id: 400 + index, ...row })),
    ];

    const rows = generateAlkoSkeleton(2027, existingEvents);
    expect(rows.map((row) => row.expectedWindow)).toEqual(['2027-03', '2027-09']);
  });

  it('non-Alko events in the year never block generation', () => {
    const existingEvents = [
      existing(2027, 'FI_EXCISE_CHANGE'),
      existing(2027, 'EE_EXCISE_CHANGE'),
      existing(2027, 'TAX_TABLE_PUBLICATION'),
      existing(2027, 'RATE_DECISION'),
    ];

    expect(generateAlkoSkeleton(2027, existingEvents)).toHaveLength(2);
  });

  it('only ever proposes ALKO_PRICE_LIST — no other type is generated', () => {
    const rows: AlkoSkeletonEvent[] = generateAlkoSkeleton(2027, []);

    const generatedTypes = new Set(rows.map((row) => row.eventType));
    expect([...generatedTypes]).toEqual(['ALKO_PRICE_LIST']);
    for (const type of CALENDAR_EVENT_TYPES) {
      if (type !== 'ALKO_PRICE_LIST') {
        expect(generatedTypes.has(type)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Caller-contract validation
// ---------------------------------------------------------------------------

describe('generateAlkoSkeleton — validation', () => {
  it('rejects a non-integer or out-of-range year — the window shape has four digits', () => {
    for (const bad of [2026.5, Number.NaN, 999, 10000, 0, -2027]) {
      expect(() => generateAlkoSkeleton(bad, [])).toThrow(InvalidCalendarInputError);
      expect(() => generateAlkoSkeleton(bad, [])).toThrow(/four-digit integer year/);
    }
  });
});

/**
 * Pure rhythm-skeleton generator — the year's two Alko EXPECTED events
 * (spec: calendar-event-automation, "Automatic rhythm-skeleton
 * generation", task 2.1).
 *
 * The module is pure: no clock, no persistence, no fetch. Input is the
 * target year plus the calendar rows that already exist for it (however
 * the caller read them); output is the rows to insert, shaped like
 * {@link CalendarEvent} WITHOUT the id — ids are assigned by the
 * repository at insert time, never by this generator, so the generator
 * stays repository-agnostic (the January cron of task 3.1 wires it to
 * the real store; nothing here knows it exists).
 *
 * GENERATION RULE (documented, deterministic):
 * 1. Windows — exactly two `ALKO_PRICE_LIST` rows, EXPECTED status,
 *    windows `YYYY-03` and `YYYY-09` (month precision, never a day):
 *    Alko's official, stable rhythm statement is that its retail prices
 *    change twice a year, normally at the end of March and September.
 * 2. Skip is all-or-nothing per year — if the year already carries
 *    EITHER Alko row (March or September, either status: an
 *    operator-upgraded CONFIRMED row covers just as well), the whole
 *    year is skipped and the empty array returned. A partial pair is
 *    never emitted: half a rhythm would be a claim the row set does
 *    not support. Non-Alko events in the year (the FI excise change,
 *    the tax-table publication, …) never block generation.
 * 3. Never CONFIRMED — every generated row is EXPECTED with a window
 *    and a `null` occurrence date. A rhythm statement is not a dated
 *    announcement; generation cannot invent day precision (the
 *    precision split of calendar.types).
 * 4. Text — versioned FI/EN constants ({@link CALENDAR_SKELETON_TEXT_FI}
 *    / {@link CALENDAR_SKELETON_TEXT_EN}), selected by nothing and
 *    composed at no time: the templates are rendered with the year and
 *    shipped verbatim. The wording describes the rhythm and states that
 *    no dated announcement exists — it never announces a change.
 * 5. Source — both rows cite the official Alko rhythm statement URL
 *    ({@link ALKO_RHYTHM_SOURCE_URL}); no unsourced rows.
 *
 * Determinism: same year and same existing rows, same output on every
 * runtime — spring (03) before autumn (09), nothing else in the row
 * order, no clock or randomness anywhere.
 *
 * @module CalendarSkeleton
 */

import {
  InvalidCalendarInputError,
  type CalendarEvent,
  type CalendarLanguage,
} from './calendar.types';

// ---------------------------------------------------------------------------
// Official source — declared here, not imported: purity forbids a
// data-platform import (the calendar.types vocabulary precedent).
// ---------------------------------------------------------------------------

/**
 * alko.fi — the official twice-yearly price-list rhythm statement
 * (verbatim from the verified-facts source of the committed 2026 seed
 * rows). Both generated rows cite it.
 */
export const ALKO_RHYTHM_SOURCE_URL =
  'https://www.alko.fi/fi/alko-oy/uutishuone/verotusmuutokset-2026';

// ---------------------------------------------------------------------------
// Versioned skeleton text — the FI/EN constant pair
// ---------------------------------------------------------------------------

/**
 * One language's skeleton wording: window-keyed title and summary
 * templates with a `{year}` placeholder, versioned so a wording change
 * is a visible constant bump (the rhythm-disclaimer pair precedent —
 * wording is never composed at request time, only rendered).
 */
export interface CalendarSkeletonText {
  readonly language: CalendarLanguage;
  /** Version of this wording — bump on any change to the templates. */
  readonly version: string;
  /** Title templates keyed by the generated window (`{year}` placeholder). */
  readonly titles: {
    readonly spring: string;
    readonly autumn: string;
  };
  /** Summary templates keyed by the generated window (`{year}` placeholder). */
  readonly summaries: {
    readonly spring: string;
    readonly autumn: string;
  };
}

export const CALENDAR_SKELETON_TEXT_FI: CalendarSkeletonText = {
  language: 'fi',
  version: '1.0',
  titles: {
    spring: 'Alkon kevään jaksovaihto (odotettu maaliskuun lopussa)',
    autumn: 'Alkon syksyn jaksovaihto (odotettu syyskuun lopussa)',
  },
  summaries: {
    spring:
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. Kevään {year} jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
    autumn:
      'Alkon vähittäismyyntihinnat vaihtuvat kaksi kertaa vuodessa, normaalisti maalis- ja syyskuun lopussa. Syksyn {year} jaksovaihdokselle ei ole vielä julkaistua päivämäärää, joten tapahtuma odottaa vahvistusta.',
  },
};

export const CALENDAR_SKELETON_TEXT_EN: CalendarSkeletonText = {
  language: 'en',
  version: '1.0',
  titles: {
    spring: 'Alko spring price-list change (expected late March)',
    autumn: 'Alko autumn price-list change (expected late September)',
  },
  summaries: {
    spring:
      'Alko changes its retail prices twice a year, normally at the end of March and September. No dated announcement exists yet for the spring {year} switch, so the event is listed as expected.',
    autumn:
      'Alko changes its retail prices twice a year, normally at the end of March and September. No dated announcement exists yet for the autumn {year} switch, so the event is listed as expected.',
  },
};

/**
 * Render a template by substituting every `{year}` occurrence with the
 * year. Pure string work — no composition beyond the substitution, so
 * the shipped wording is always the constant's wording.
 */
function renderTemplate(template: string, year: number): string {
  return template.replaceAll('{year}', String(year));
}

// ---------------------------------------------------------------------------
// Generated row shape — CalendarEvent minus the repository-assigned id
// ---------------------------------------------------------------------------

/** A skeleton row: everything the repository needs to insert, id excepted. */
export type AlkoSkeletonEvent = Omit<CalendarEvent, 'id'>;

/**
 * The coverage input: only the fields the skip rule reads. The caller
 * passes whatever event rows it already holds for the year (or the
 * whole table) — any shape with a `year` and an `eventType` works, so
 * the generator stays decoupled from the repository's read API.
 */
export type CalendarSkeletonCoverageEvent = Pick<CalendarEvent, 'year' | 'eventType'>;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the year's Alko skeleton — the two EXPECTED rows (windows
 * `YYYY-03` and `YYYY-09`, in that order), or the empty array when the
 * year is already covered.
 *
 * Covered means: the existing rows contain ANY `ALKO_PRICE_LIST` event
 * for the year (either window, either status) — the skip is
 * all-or-nothing per year, so a half-present rhythm is never "fixed"
 * by appending a missing half. Deterministic and idempotent: running
 * the generator twice over the same store state yields the same rows,
 * and after the first run's rows are inserted the second run yields
 * nothing.
 *
 * Pure — no clock, no persistence, no input mutation. Throws
 * {@link InvalidCalendarInputError} for a non-integer year or one
 * outside 1000–9999: the window shape (`YYYY-MM`) has room for exactly
 * four digits, and a year that cannot produce a valid window would
 * otherwise fail only later, at the persistence boundary.
 *
 * @param year — the calendar year to cover (four-digit integer).
 * @param existingEvents — rows already known; only `year` and
 *   `eventType` are read.
 */
export function generateAlkoSkeleton(
  year: number,
  existingEvents: readonly CalendarSkeletonCoverageEvent[],
): AlkoSkeletonEvent[] {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new InvalidCalendarInputError(
      `calendar.year must be a four-digit integer year (1000–9999), got ${String(year)}`,
    );
  }

  // All-or-nothing per year: EITHER Alko row present → skip the year.
  const covered = existingEvents.some(
    (event) => event.eventType === 'ALKO_PRICE_LIST' && event.year === year,
  );
  if (covered) {
    return [];
  }

  const text = CALENDAR_SKELETON_TEXT_FI;
  const textEn = CALENDAR_SKELETON_TEXT_EN;

  return [
    {
      year,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: `${year}-03`,
      titleFi: renderTemplate(text.titles.spring, year),
      titleEn: renderTemplate(textEn.titles.spring, year),
      summaryFi: renderTemplate(text.summaries.spring, year),
      summaryEn: renderTemplate(textEn.summaries.spring, year),
      sourceUrl: ALKO_RHYTHM_SOURCE_URL,
    },
    {
      year,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: `${year}-09`,
      titleFi: renderTemplate(text.titles.autumn, year),
      titleEn: renderTemplate(textEn.titles.autumn, year),
      summaryFi: renderTemplate(text.summaries.autumn, year),
      summaryEn: renderTemplate(textEn.summaries.autumn, year),
      sourceUrl: ALKO_RHYTHM_SOURCE_URL,
    },
  ];
}

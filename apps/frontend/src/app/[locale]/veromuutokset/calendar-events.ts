/**
 * Client-side contract and pure grouping helpers for the tax-change
 * calendar page (task 4.1, change tax-change-calendar).
 *
 * The DTO mirrors the public route's payload shape
 * (`apps/api-worker/src/routes/calendar.routes.ts`, `calendarEventBody`)
 * verbatim — the same status/precision split the persistence boundary
 * enforces: a CONFIRMED row carries `occurrenceDate`, an EXPECTED row
 * carries `expectedWindow` (`YYYY-MM` / `YYYY-Qn`) and never an exact
 * date. Rendering cannot invent precision the row does not carry.
 *
 * Grouping turns the API's deterministic flat order into the year
 * timeline's month/window groups: CONFIRMED events group under their
 * occurrence month, EXPECTED events under their window's month (or a
 * quarter group for `YYYY-Qn` windows). The API order is preserved
 * inside every group; groups order by their period start ascending.
 *
 * @module CalendarEvents
 */

/** One calendar event as `GET /api/v1/calendar/events` serves it. */
export interface CalendarEventDto {
  readonly id: number;
  readonly year: number;
  readonly eventType: string;
  readonly status: 'CONFIRMED' | 'EXPECTED';
  /** CONFIRMED only: ISO `YYYY-MM-DD`. */
  readonly occurrenceDate: string | null;
  /** EXPECTED only: `YYYY-MM` or `YYYY-Qn`. */
  readonly expectedWindow: string | null;
  readonly titleFi: string;
  readonly titleEn: string;
  readonly summaryFi: string;
  readonly summaryEn: string;
  readonly sourceUrl: string;
}

/** Response of `GET /api/v1/calendar/events?year=&language=`. */
export interface CalendarEventsResponse {
  readonly year: number;
  /** Structural rhythm disclaimer in the requested language. */
  readonly disclaimer: string;
  readonly events: readonly CalendarEventDto[];
}

/**
 * The timeline's year bounds for query-param normalization. The seeded
 * set and the ops maintenance path live in the present era; anything
 * outside this range renders the current year instead of an empty
 * timeline for a typo (the value page's forgiving-resolution precedent).
 */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Resolve the timeline year from the raw `?year=` query value: an
 * integer within the accepted bounds passes through, anything else —
 * missing, junk, out of bounds — falls back to the current year. Pure:
 * the caller supplies the clock read.
 */
export function resolveCalendarYear(
  raw: string | string[] | undefined,
  currentYear: number,
): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (
    value === undefined ||
    value === '' ||
    !Number.isInteger(parsed) ||
    parsed < MIN_YEAR ||
    parsed > MAX_YEAR
  ) {
    return currentYear;
  }
  return parsed;
}

/** One timeline group: a month or a quarter window and its events. */
export interface CalendarEventGroup {
  /** Stable React key: the month (`YYYY-MM`) or window (`YYYY-Qn`). */
  readonly key: string;
  /** Group's period start as ISO `YYYY-MM-DD` — the ascending sort key. */
  readonly sortKey: string;
  /** Locale base label, e.g. `Tammikuu 2026` / `Q4 2026` — no marker. */
  readonly label: string;
  /**
   * True when every event in the group is EXPECTED — the group heading
   * then carries the expected-window marker ("(odotettu)" / "Expected").
   * A month holding both a CONFIRMED date and an EXPECTED window is
   * labelled as a plain month; the per-card badges stay authoritative.
   */
  readonly isExpected: boolean;
  /** The group's events in the API's deterministic order. */
  readonly events: readonly CalendarEventDto[];
}

/** The site language — selects labels and the API's disclaimer language. */
export type CalendarPageLanguage = 'fi' | 'en';

/** Intl locale tag behind the label conventions (the date-formatter split). */
function intlLocale(language: CalendarPageLanguage): string {
  return language === 'fi' ? 'fi-FI' : 'en-GB';
}

/**
 * `YYYY-MM` → `Tammikuu 2026` (fi, initial capital for the heading) /
 * `January 2026` (en). Parsing and formatting pin UTC so the rendered
 * month is the stored month on every runtime (the date-formatter rule).
 */
function monthLabel(yearMonth: string, language: CalendarPageLanguage): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (match === null) return yearMonth;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, 1),
  );
  const formatted = date.toLocaleDateString(intlLocale(language), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  // Finnish month names are lowercase in prose; headings start capital.
  return formatted.charAt(0).toLocaleUpperCase(intlLocale(language)) + formatted.slice(1);
}

/** `YYYY-Qn` → `Q4 2026` (both locales — the quarter tag is language-neutral). */
function quarterLabel(window: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(window);
  if (match === null) return window;
  return `Q${match[2]} ${match[1]}`;
}

/** First day of a quarter window, ISO — the group sort key. */
function quarterStartDay(window: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(window);
  if (match === null) return `${window}-01`;
  const startMonth = (Number(match[2]) - 1) * 3 + 1;
  return `${match[1]}-${String(startMonth).padStart(2, '0')}-01`;
}

/**
 * Group the year's events for the timeline. PRESERVES the API's
 * deterministic order inside each group (no re-sorting of events);
 * groups order by period start ascending, insertion-stable for equal
 * keys. A malformed date or window (cannot exist through the
 * persistence boundary) degrades to an unlabelled trailing group
 * instead of throwing — one bad row must not blank the timeline.
 */
export function groupCalendarEvents(
  events: readonly CalendarEventDto[],
  language: CalendarPageLanguage,
): readonly CalendarEventGroup[] {
  const byKey = new Map<string, CalendarEventGroup>();

  for (const event of events) {
    let key: string;
    let sortKey: string;
    let label: string;
    if (event.status === 'CONFIRMED' && event.occurrenceDate !== null) {
      key = event.occurrenceDate.slice(0, 7);
      sortKey = `${key}-01`;
      label = monthLabel(key, language);
    } else if (event.status === 'EXPECTED' && event.expectedWindow !== null) {
      key = event.expectedWindow;
      sortKey = /^\d{4}-Q[1-4]$/.test(key)
        ? quarterStartDay(key)
        : `${key}-01`;
      label = /\d{4}-Q[1-4]$/.test(key)
        ? quarterLabel(key)
        : monthLabel(key, language);
    } else {
      // Contract violation — kept visible under an honest raw key
      // rather than dropped silently or crashed upon.
      key = `raw-${event.id}`;
      sortKey = '9999-12-31';
      label = event.occurrenceDate ?? event.expectedWindow ?? `#${event.id}`;
    }

    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, events: [...existing.events, event] });
    } else {
      byKey.set(key, { key, sortKey, label, isExpected: false, events: [event] });
    }
  }

  const groups = [...byKey.values()].map((group) => ({
    ...group,
    isExpected: group.events.every((event) => event.status === 'EXPECTED'),
  }));

  // Insertion-stable ascending order (Array.prototype.sort is stable),
  // with one tie-break mirroring the domain's next-event rule: on equal
  // period starts — a quarter window opening the same month as a dated
  // group — the CONFIRMED group precedes the EXPECTED window.
  return groups.sort(
    (a, b) =>
      a.sortKey.localeCompare(b.sortKey) ||
      Number(a.isExpected) - Number(b.isExpected),
  );
}

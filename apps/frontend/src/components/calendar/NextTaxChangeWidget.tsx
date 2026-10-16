// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';

// ---------------------------------------------------------------------------
// API contract — mirrors GET /api/v1/calendar/next's serialization EXACTLY
// (tax-change-calendar task 3.2, apps/api-worker/src/routes/calendar.routes.ts;
// the frontend type lives here because the touch set is the homepage scope and
// the route remains the single source of truth).
// ---------------------------------------------------------------------------

/** One calendar event row — every sourced field verbatim from the domain shape. */
export interface CalendarNextEvent {
  readonly id: number;
  readonly year: number;
  readonly eventType: string;
  /** The row's own status — also mirrored at the response's top level. */
  readonly status: string;
  /** CONFIRMED only: ISO `YYYY-MM-DD`. `null` for EXPECTED rows. */
  readonly occurrenceDate: string | null;
  /**
   * EXPECTED only: `YYYY-MM` or `YYYY-Qn`. `null` for CONFIRMED rows —
   * a window must never render a countdown (the pure module's own rule).
   */
  readonly expectedWindow: string | null;
  readonly titleFi: string;
  readonly titleEn: string;
  readonly summaryFi: string;
  readonly summaryEn: string;
  readonly sourceUrl: string;
}

/**
 * The versioned rhythm disclaimer exactly as the route serializes it —
 * the core-domain selector's object verbatim (`{text, language,
 * version}`), never a bare string.
 */
export interface CalendarDisclaimer {
  readonly text: string;
  readonly language: string;
  readonly version: string;
}

/** GET /api/v1/calendar/next response (age-gated; server fetch carries the token). */
export interface CalendarNextResponse {
  /** The UTC day the route's single clock read produced (`YYYY-MM-DD`). */
  readonly fromDate: string;
  readonly event: CalendarNextEvent;
  readonly status: string;
  /** Whole-day countdown — CONFIRMED only, `null` for EXPECTED rows. */
  readonly daysUntil: number | null;
  readonly expectedWindow: string | null;
  /** The versioned rhythm disclaimer, selected by the request's language. */
  readonly disclaimer: CalendarDisclaimer;
}

/**
 * Structural check mirroring `calendar-events.ts`'s guard (the two
 * consumer modules speak one payload shape): an object with a non-empty
 * string `text` and present, non-empty `language`/`version` strings.
 * The payload arrives as parsed JSON — an object where a string was
 * typed — so the derive must re-establish the shape before rendering.
 */
function isCalendarDisclaimer(value: unknown): value is CalendarDisclaimer {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.text === 'string' &&
    candidate.text !== '' &&
    typeof candidate.language === 'string' &&
    candidate.language !== '' &&
    typeof candidate.version === 'string' &&
    candidate.version !== ''
  );
}

// ---------------------------------------------------------------------------
// State derivation — the widget stays presentational (HomeGapHero pattern)
// ---------------------------------------------------------------------------

/**
 * The widget's render state, derived from the server read: the CONFIRMED
 * and EXPECTED presentations the task names, or `hidden` when the read
 * failed or the payload violates its contract. Degradation is the
 * widget's core contract: the homepage must never break because the
 * calendar API failed, and no state may invent a countdown, a window, or
 * a title the payload does not carry.
 */
export type NextTaxChangeState =
  | {
      readonly kind: 'confirmed';
      readonly title: string;
      readonly daysUntil: number;
    }
  | {
      readonly kind: 'expected';
      readonly title: string;
      readonly windowLabel: string;
      readonly disclaimer: string;
    }
  | { readonly kind: 'hidden' };

/** The shared hidden state — every contract violation degrades here. */
const HIDDEN: NextTaxChangeState = { kind: 'hidden' };

/** The widget's locale, already normalized by the page (`fi` | `en`). */
type WidgetLocale = 'fi' | 'en';

/**
 * The calendar page's URL path for one locale. Computed locally because
 * the typed i18n `Link` requires a `routing.pathnames` entry for
 * `/tax-changes`, which lands with the calendar-page task (4.1) — these
 * are exactly the strings that entry produces under `localePrefix:
 * 'as-needed'` (fi bare segment, en under `/en`), so the switch to the
 * i18n Link is a no-op for the rendered URLs.
 */
export function calendarPageHref(locale: string): string {
  return locale === 'en' ? '/en/tax-changes' : '/veromuutokset';
}

/**
 * Human label for an EXPECTED event's window — deliberately simple (the
 * month's name, or the quarter), mirroring the core-domain module's own
 * closed window grammar (`YYYY-MM` with months 01–12, `YYYY-Q[1-4]`).
 * Anything else fails closed as `null`: an unparseable window never
 * renders, and the derivation hides the whole widget (a window label
 * guessed from a malformed value would fabricate precision).
 */
export function formatExpectedWindowLabel(
  window: string,
  locale: string,
): string | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(window);
  if (quarter !== null) return `Q${quarter[2]} ${quarter[1]}`;

  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(window);
  if (month !== null) {
    // The first-of-month anchor pinned to UTC — the same locale-format
    // construction HomeGapHero uses, so the label renders identically
    // regardless of the server's time zone.
    return new Date(
      Date.UTC(Number(month[1]), Number(month[2]) - 1, 1),
    ).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fi-FI', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  return null;
}

/**
 * Derive the widget's state from the /calendar/next read (or `null` on a
 * failed read — the page's degrade-to-null fetch pattern). The payload's
 * status drives the split; every contract violation (unknown status, a
 * CONFIRMED row without a whole-day non-negative countdown, an EXPECTED
 * row without a parseable window, a missing locale title or disclaimer)
 * degrades to `hidden`. The API recomputes `daysUntil` through the pure
 * module, so the figure is presented as received — never recounted here.
 */
export function deriveNextTaxChangeState(
  read: CalendarNextResponse | null,
  locale: string,
): NextTaxChangeState {
  if (read === null || typeof read !== 'object') return HIDDEN;
  const { event, status, daysUntil, disclaimer } = read;
  if (event === null || typeof event !== 'object') return HIDDEN;
  // Structural check on the versioned object the route actually serves —
  // a violated shape is a contract violation and degrades to hidden.
  if (!isCalendarDisclaimer(disclaimer)) return HIDDEN;

  const normalizedLocale: WidgetLocale = locale === 'en' ? 'en' : 'fi';
  const title = normalizedLocale === 'en' ? event.titleEn : event.titleFi;
  if (typeof title !== 'string' || title === '') return HIDDEN;

  if (status === 'CONFIRMED') {
    if (
      typeof daysUntil !== 'number' ||
      !Number.isInteger(daysUntil) ||
      daysUntil < 0
    ) {
      return HIDDEN;
    }
    return { kind: 'confirmed', title, daysUntil };
  }

  if (status === 'EXPECTED') {
    const window = event.expectedWindow;
    if (typeof window !== 'string') return HIDDEN;
    const windowLabel = formatExpectedWindowLabel(window, normalizedLocale);
    if (windowLabel === null) return HIDDEN;
    return { kind: 'expected', title, windowLabel, disclaimer: disclaimer.text };
  }

  return HIDDEN;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** The NextTaxChange-namespace translator page.tsx passes down. */
export type NextTaxChangeTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface NextTaxChangeWidgetProps {
  readonly state: NextTaxChangeState;
  readonly locale: string;
  readonly t: NextTaxChangeTranslator;
}

/**
 * The homepage's next-tax-change widget (tax-change-calendar task 4.2).
 *
 * One quiet card: the next event's title, and per status either the
 * whole-day countdown (CONFIRMED — the API's own figure, presented as
 * received) or the simple window label plus the structural rhythm
 * disclaimer from the API (EXPECTED). The EXPECTED branch renders NO
 * countdown node at all — a window must never claim day precision, so
 * there is nothing to hide, the branch simply does not exist. The card
 * links to the calendar page for the full timeline.
 *
 * Degradation renders nothing: `hidden` returns `null` and the
 * homepage's shell stands untouched (the same inert-degradation contract
 * as the homepage FAQ section).
 */
export default function NextTaxChangeWidget({
  state,
  locale,
  t,
}: NextTaxChangeWidgetProps) {
  if (state.kind === 'hidden') return null;

  return (
    <section
      aria-labelledby="next-tax-change-heading"
      data-testid="next-tax-change"
      className="border-b border-gray-100 bg-white px-4 py-12 sm:px-6"
    >
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-gray-50 p-6 text-center shadow-sm">
        <h2
          id="next-tax-change-heading"
          className="text-xs font-semibold uppercase tracking-wide text-primary-700"
        >
          {t('heading')}
        </h2>

        <p className="mt-2 text-lg font-bold text-gray-900">{state.title}</p>

        {/* CONFIRMED only — the countdown branch literally does not exist
            for EXPECTED states, so no day figure can leak into a window
            presentation. daysUntil 0 means the event is today. */}
        {state.kind === 'confirmed' && (
          <p
            data-testid="next-tax-change-countdown"
            className="mt-1 text-sm font-semibold tabular-nums text-primary-700"
          >
            {state.daysUntil === 0
              ? t('today')
              : t('inDays', { days: state.daysUntil })}
          </p>
        )}

        {state.kind === 'expected' && (
          <>
            <p
              data-testid="next-tax-change-window"
              className="mt-1 text-sm font-semibold text-primary-700"
            >
              {state.windowLabel}
            </p>
            {/* The API's structural rhythm disclaimer, verbatim — quiet
                neutral one-liner (disclaimer-as-structure, D6). */}
            <p
              data-testid="next-tax-change-disclaimer"
              className="mt-3 text-xs leading-relaxed text-gray-500"
            >
              {state.disclaimer}
            </p>
          </>
        )}

        <a
          href={calendarPageHref(locale)}
          data-testid="next-tax-change-link"
          className="mt-4 inline-block text-sm font-medium text-primary-700 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {t('linkLabel')} →
        </a>
      </div>
    </section>
  );
}

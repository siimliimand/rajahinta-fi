/**
 * NextTaxChangeWidget tests (tax-change-calendar task 4.2).
 *
 * The widget is presentational (the translator arrives as a prop, the
 * HomeGapHero pattern), so the states render against a locally stubbed
 * NextTaxChange catalog — no next-intl plumbing, no network. The file
 * pins the task's state contract:
 *
 *   - CONFIRMED: title + the whole-day countdown + the calendar-page
 *     link (fi `/veromuutokset`, en `/en/tax-changes`).
 *   - EXPECTED: the simple window label + the API's disclaimer, and NO
 *     countdown node anywhere in the DOM — asserted by the countdown
 *     test hook's absence AND by the absence of the stub countdown copy
 *     (the stub is built so any countdown render would fail the pin).
 *   - hidden: renders nothing at all.
 *
 * The pure derivation helpers are pinned separately: contract violations
 * (unknown status, a CONFIRMED row without a whole-day countdown, an
 * EXPECTED row with an unparseable window, a missing locale title)
 * degrade to `hidden`, and the window-label grammar mirrors the
 * core-domain module's closed `YYYY-MM` / `YYYY-Qn` shapes, failing
 * closed on anything else.
 *
 * @module NextTaxChangeWidgetTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NextTaxChangeWidget, {
  calendarPageHref,
  deriveNextTaxChangeState,
  formatExpectedWindowLabel,
  type CalendarNextResponse,
  type NextTaxChangeState,
} from './NextTaxChangeWidget';

// ---------------------------------------------------------------------------
// Local stub catalog — the keys task 4.3 will own; stubbed test-locally
// here (the production catalogs must not gain entries from this task).
// The countdown copy deliberately contains "päivän kuluttua" so the
// EXPECTED no-countdown assertion cannot pass vacuously.
// ---------------------------------------------------------------------------

const STUB_MESSAGES: Record<string, string> = {
  heading: 'Seuraava veromuutos',
  inDays: '{days} päivän kuluttua',
  today: 'Tänään',
  linkLabel: 'Katso veromuutokset',
};

function stubT(
  key: string,
  values?: Record<string, string | number>,
): string {
  const value = STUB_MESSAGES[key];
  if (value === undefined) return `__MISSING_${key}__`;
  return value.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    values && name in values ? String(values[name]) : placeholder,
  );
}

/** Render one state to a DOM tree the way the server would. */
function renderWidget(state: NextTaxChangeState, locale = 'fi'): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = renderToString(
    React.createElement(NextTaxChangeWidget, { state, locale, t: stubT }),
  );
  return container;
}

// ---------------------------------------------------------------------------
// CONFIRMED state — title, day countdown, calendar-page link
// ---------------------------------------------------------------------------

describe('NextTaxChangeWidget CONFIRMED state', () => {
  const confirmed: NextTaxChangeState = {
    kind: 'confirmed',
    title: 'Veromuutos: olutveron kannat',
    daysUntil: 12,
  };

  it('renders the event title, the day countdown, and the calendar-page link', () => {
    const dom = renderWidget(confirmed);

    expect(dom.querySelector('[data-testid="next-tax-change"]')).not.toBeNull();
    expect(dom.textContent).toContain('Veromuutos: olutveron kannat');

    const countdown = dom.querySelector<HTMLElement>(
      '[data-testid="next-tax-change-countdown"]',
    );
    expect(countdown).not.toBeNull();
    expect(countdown?.textContent).toContain('12');
    expect(countdown?.textContent).toContain('päivän kuluttua');

    const link = dom.querySelector<HTMLAnchorElement>(
      '[data-testid="next-tax-change-link"]',
    );
    expect(link?.getAttribute('href')).toBe('/veromuutokset');
  });

  it('renders the singular countdown via the translator values (1 day)', () => {
    const dom = renderWidget({ ...confirmed, daysUntil: 1 });

    const countdown = dom.querySelector<HTMLElement>(
      '[data-testid="next-tax-change-countdown"]',
    );
    expect(countdown?.textContent).toContain('1');
    // The days value reaches the translator for its singular/plural
    // handling — the widget itself never formats the figure.
    expect(countdown?.textContent).not.toContain('12');
  });

  it('renders the today wording for a daysUntil of 0, with no days figure', () => {
    const dom = renderWidget({ ...confirmed, daysUntil: 0 });

    const countdown = dom.querySelector<HTMLElement>(
      '[data-testid="next-tax-change-countdown"]',
    );
    expect(countdown?.textContent).toContain('Tänään');
    expect(countdown?.textContent).not.toContain('0');
    expect(countdown?.textContent).not.toContain('kuluttua');
  });

  it('links the en locale to the prefixed internal route name', () => {
    const dom = renderWidget(confirmed, 'en');

    const link = dom.querySelector<HTMLAnchorElement>(
      '[data-testid="next-tax-change-link"]',
    );
    expect(link?.getAttribute('href')).toBe('/en/tax-changes');
  });
});

// ---------------------------------------------------------------------------
// EXPECTED state — window label + disclaimer, and NO countdown anywhere
// ---------------------------------------------------------------------------

describe('NextTaxChangeWidget EXPECTED state', () => {
  const expected: NextTaxChangeState = {
    kind: 'expected',
    title: 'Alkon hintaluettelon vaihto',
    windowLabel: 'Q4 2026',
    disclaimer: 'Vuosirytmi: ajankohdat toistuvat saman kalenterirytmin mukaan.',
  };

  it('renders the title, the window label, and the API disclaimer', () => {
    const dom = renderWidget(expected);

    expect(dom.textContent).toContain('Alkon hintaluettelon vaihto');
    expect(
      dom.querySelector('[data-testid="next-tax-change-window"]')
        ?.textContent,
    ).toBe('Q4 2026');
    expect(
      dom
        .querySelector('[data-testid="next-tax-change-disclaimer"]')
        ?.textContent,
    ).toContain('Vuosirytmi');
    expect(
      dom.querySelector('[data-testid="next-tax-change-link"]')?.getAttribute('href'),
    ).toBe('/veromuutokset');
  });

  it('renders no countdown node and no day wording anywhere in the DOM', () => {
    const dom = renderWidget(expected);

    // The countdown branch does not exist for the EXPECTED state.
    expect(
      dom.querySelector('[data-testid="next-tax-change-countdown"]'),
    ).toBeNull();
    // And no day-countdown wording — the stub catalog would render
    // exactly these strings had the countdown path been taken.
    expect(dom.textContent).not.toContain('päivän kuluttua');
    expect(dom.textContent).not.toContain('päivää');
    expect(dom.textContent).not.toContain('Tänään');
  });
});

// ---------------------------------------------------------------------------
// hidden state — the graceful fallback renders nothing
// ---------------------------------------------------------------------------

describe('NextTaxChangeWidget hidden state', () => {
  it('renders nothing at all', () => {
    const dom = renderWidget({ kind: 'hidden' });
    expect(dom.innerHTML).toBe('');
    expect(dom.querySelector('[data-testid="next-tax-change"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Derivation — contract violations degrade to hidden, window labels
// mirror the core-domain closed grammar
// ---------------------------------------------------------------------------

/** A payload honoring the route's serialization; tests override per case. */
function nextResponse(
  overrides: Partial<CalendarNextResponse> = {},
): CalendarNextResponse {
  return {
    fromDate: '2026-10-16',
    event: {
      id: 1,
      year: 2026,
      eventType: 'FI_EXCISE',
      status: 'CONFIRMED',
      occurrenceDate: '2026-10-28',
      expectedWindow: null,
      titleFi: 'Veronkorotus voimaan',
      titleEn: 'Tax increase takes effect',
      summaryFi: 'Yhteenveto',
      summaryEn: 'Summary',
      sourceUrl: 'https://veroon.fi/test',
    },
    status: 'CONFIRMED',
    daysUntil: 12,
    expectedWindow: null,
    disclaimer: 'Vuosirytmi: …',
    ...overrides,
  };
}

describe('deriveNextTaxChangeState', () => {
  it('derives the confirmed state from a well-formed payload', () => {
    expect(
      deriveNextTaxChangeState(nextResponse(), 'fi'),
    ).toEqual<NextTaxChangeState>({
      kind: 'confirmed',
      title: 'Veronkorotus voimaan',
      daysUntil: 12,
    });
  });

  it('selects the en title for the en locale', () => {
    expect(deriveNextTaxChangeState(nextResponse(), 'en')).toMatchObject({
      title: 'Tax increase takes effect',
    });
  });

  it('derives the expected state with the window label and the verbatim disclaimer', () => {
    const read = nextResponse({
      status: 'EXPECTED',
      daysUntil: null,
      event: {
        ...nextResponse().event,
        status: 'EXPECTED',
        occurrenceDate: null,
        expectedWindow: '2026-Q4',
        titleFi: 'Alkon hintaluettelon vaihto',
        titleEn: 'Alko price-list switch',
      },
      expectedWindow: '2026-Q4',
    });
    expect(deriveNextTaxChangeState(read, 'fi')).toEqual<NextTaxChangeState>({
      kind: 'expected',
      title: 'Alkon hintaluettelon vaihto',
      windowLabel: 'Q4 2026',
      disclaimer: 'Vuosirytmi: …',
    });
  });

  it('hides on a failed read (null)', () => {
    expect(deriveNextTaxChangeState(null, 'fi').kind).toBe('hidden');
  });

  it('hides when a CONFIRMED payload carries no whole-day countdown', () => {
    expect(deriveNextTaxChangeState(nextResponse({ daysUntil: null }), 'fi').kind).toBe('hidden');
    expect(deriveNextTaxChangeState(nextResponse({ daysUntil: -1 }), 'fi').kind).toBe('hidden');
    expect(deriveNextTaxChangeState(nextResponse({ daysUntil: 1.5 }), 'fi').kind).toBe('hidden');
  });

  it('hides when an EXPECTED payload carries no parseable window', () => {
    const read = nextResponse({
      status: 'EXPECTED',
      daysUntil: null,
      event: { ...nextResponse().event, status: 'EXPECTED', occurrenceDate: null, expectedWindow: null },
      expectedWindow: null,
    });
    expect(deriveNextTaxChangeState(read, 'fi').kind).toBe('hidden');
  });

  it('hides on an unknown status, a missing title, or a missing disclaimer', () => {
    expect(
      deriveNextTaxChangeState(nextResponse({ status: 'DRAFT' }), 'fi').kind,
    ).toBe('hidden');
    expect(
      deriveNextTaxChangeState(
        nextResponse({ event: { ...nextResponse().event, titleFi: '' } }),
        'fi',
      ).kind,
    ).toBe('hidden');
    expect(
      deriveNextTaxChangeState(nextResponse({ disclaimer: '' }), 'fi').kind,
    ).toBe('hidden');
  });
});

describe('formatExpectedWindowLabel', () => {
  it('formats quarters as Qn year', () => {
    expect(formatExpectedWindowLabel('2026-Q4', 'fi')).toBe('Q4 2026');
    expect(formatExpectedWindowLabel('2027-Q1', 'en')).toBe('Q1 2027');
  });

  it('formats months with the locale month name via the UTC-pinned construction', () => {
    const expected = new Date(Date.UTC(2026, 2, 1)).toLocaleDateString(
      'fi-FI',
      { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );
    expect(formatExpectedWindowLabel('2026-03', 'fi')).toBe(expected);
    const expectedEn = new Date(Date.UTC(2026, 0, 1)).toLocaleDateString(
      'en-GB',
      { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );
    expect(formatExpectedWindowLabel('2026-01', 'en')).toBe(expectedEn);
  });

  it('fails closed on shapes outside the core-domain window grammar', () => {
    expect(formatExpectedWindowLabel('2026-13', 'fi')).toBeNull();
    expect(formatExpectedWindowLabel('2026-Q5', 'fi')).toBeNull();
    expect(formatExpectedWindowLabel('2026-00', 'fi')).toBeNull();
    expect(formatExpectedWindowLabel('syksy', 'fi')).toBeNull();
    expect(formatExpectedWindowLabel('', 'fi')).toBeNull();
  });
});

describe('calendarPageHref', () => {
  it('serves the fi bare segment and the en-prefixed internal route', () => {
    expect(calendarPageHref('fi')).toBe('/veromuutokset');
    expect(calendarPageHref('en')).toBe('/en/tax-changes');
    // Anything else falls to the default locale's form.
    expect(calendarPageHref('sv')).toBe('/veromuutokset');
  });
});

/**
 * Homepage next-tax-change widget tests (tax-change-calendar task 4.2).
 *
 * Renders the REAL server component the way Next's RSC runtime would
 * (page.ssr.test.tsx's approach — only Next server plumbing is mocked)
 * with the calendar read stubbed by URL, pinning the widget's wiring
 * through the page's degrade-to-null fetch:
 *
 *   - a well-formed CONFIRMED read renders the widget with the title,
 *     the day countdown, and the /veromuutokset link;
 *   - an EXPECTED read renders the window label + the API's disclaimer
 *     and NO countdown node or day wording anywhere;
 *   - a failed calendar read renders NO widget while the page shell
 *     (hero, sections) stands untouched — the homepage never breaks
 *     because the calendar API failed.
 *
 * The NextTaxChange namespace is stubbed test-locally (merged over the
 * fi catalog inside the next-intl mock) — task 4.3 owns the real
 * catalog entries.
 *
 * @module HomePageCalendarWidgetTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HomePage from './page';
import type { CalendarNextResponse } from '@/components/calendar/NextTaxChangeWidget';

// ---------------------------------------------------------------------------
// Local NextTaxChange stub catalog — the keys task 4.3 will own. It is
// merged over the fi catalog inside the next-intl mock below (declared
// via vi.hoisted so the hoisted mock factory can reach it).
// ---------------------------------------------------------------------------

const { stubTable } = vi.hoisted(() => ({
  stubTable: {
    NextTaxChange: {
      heading: 'Seuraava veromuutos',
      inDays: '{days} päivän kuluttua',
      today: 'Tänään',
      linkLabel: 'Katso veromuutokset',
    },
  },
}));

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const catalog = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    const table: Record<string, unknown> = { ...catalog, ...stubTable };
    return (key: string, values?: Record<string, unknown>) => {
      const value = ns
        ? (table[ns] as Record<string, unknown> | undefined)?.[key]
        : key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            table,
          );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return value.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        values && name in values ? String(values[name]) : placeholder,
      );
    };
  },
}));

// The i18n Link is a Next router-aware component; under renderToString it
// renders as a plain anchor with the href it was given (the shared testing
// double).
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

// The accuracy statistic is a self-contained client island with its own
// fetch and its own test file — stub it so the render stays offline.
vi.mock('./components/AccuracyStat', () => ({
  default: () => React.createElement('div', { 'data-testid': 'accuracy-trust-row-stub' }),
}));

// ---------------------------------------------------------------------------
// Calendar read stubbing — the calendar URL answers the scenario, every
// other server read (overview, top, guides) fails and degrades.
// ---------------------------------------------------------------------------

/** The URL substring that identifies the widget's calendar read. */
const CALENDAR_NEXT_URL = '/api/v1/calendar/next';

function confirmedBody(): CalendarNextResponse {
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
  };
}

function expectedBody(): CalendarNextResponse {
  return {
    fromDate: '2026-10-16',
    event: {
      id: 2,
      year: 2026,
      eventType: 'ALKO_PRICE_LIST',
      status: 'EXPECTED',
      occurrenceDate: null,
      expectedWindow: '2026-Q4',
      titleFi: 'Alkon hintaluettelon vaihto',
      titleEn: 'Alko price-list switch',
      summaryFi: 'Yhteenveto',
      summaryEn: 'Summary',
      sourceUrl: 'https://alko.fi/test',
    },
    status: 'EXPECTED',
    daysUntil: null,
    expectedWindow: '2026-Q4',
    disclaimer: 'Vuosirytmi: merkintä kuvaa julkaisuaikataulua.',
  };
}

type CalendarStub = { readonly body: unknown } | 'fail';

/** Render the homepage HTML with the calendar read answering `stub`, rest offline. */
async function renderHomeWithCalendar(stub: CalendarStub): Promise<string> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : String((input as { url?: unknown })?.url ?? input);
      if (url.includes(CALENDAR_NEXT_URL)) {
        if (stub === 'fail') throw new Error('calendar read failed (mocked)');
        return { ok: true, status: 200, json: async () => stub.body };
      }
      // Every other server read degrades: non-ok → null / hidden / no section.
      return { ok: false, status: 503, json: async () => ({}) };
    }),
  );
  try {
    const element = await HomePage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    return renderToString(element);
  } finally {
    vi.unstubAllGlobals();
  }
}

/** The rendered widget element, or null when it did not render. */
function calendarWidget(html: string): HTMLElement | null {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.querySelector<HTMLElement>(
    '[data-testid="next-tax-change"]',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePage next-tax-change widget (tax-change-calendar task 4.2)', () => {
  it('renders the CONFIRMED event with title, day countdown, and the /veromuutokset link', async () => {
    const html = await renderHomeWithCalendar({ body: confirmedBody() });

    const widget = calendarWidget(html);
    expect(widget).not.toBeNull();
    expect(widget?.textContent).toContain('Veronkorotus voimaan');

    const countdown = widget?.querySelector<HTMLElement>(
      '[data-testid="next-tax-change-countdown"]',
    );
    expect(countdown).not.toBeNull();
    expect(countdown?.textContent).toContain('12');
    expect(countdown?.textContent).toContain('päivän kuluttua');

    expect(
      widget
        ?.querySelector<HTMLAnchorElement>(
          '[data-testid="next-tax-change-link"]',
        )
        ?.getAttribute('href'),
    ).toBe('/veromuutokset');
  });

  it('renders the EXPECTED event with window label + disclaimer and NO countdown', async () => {
    const html = await renderHomeWithCalendar({ body: expectedBody() });

    const widget = calendarWidget(html);
    expect(widget).not.toBeNull();
    expect(widget?.textContent).toContain('Alkon hintaluettelon vaihto');
    expect(widget?.querySelector('[data-testid="next-tax-change-window"]')?.textContent)
      .toBe('Q4 2026');
    expect(widget?.querySelector('[data-testid="next-tax-change-disclaimer"]')?.textContent)
      .toContain('Vuosirytmi');

    // No countdown may render for a window event — neither the node nor
    // any day wording (the stub countdown copy would contain these).
    expect(widget?.querySelector('[data-testid="next-tax-change-countdown"]'))
      .toBeNull();
    expect(widget?.textContent).not.toContain('päivän kuluttua');
    expect(widget?.textContent).not.toContain('päivää');
    expect(widget?.textContent).not.toContain('Tänään');
  });

  it('renders no widget on a failed calendar read while the page shell stands', async () => {
    const html = await renderHomeWithCalendar('fail');

    expect(calendarWidget(html)).toBeNull();

    // The page shell is intact: hero, live gap section, task cards, and
    // the widget-less flow broke nothing.
    expect(html).toContain(
      'Laske alkoholin todellinen kokonaishinta Suomeen',
    );
    expect(html).toContain('data-testid="home-gap-hero"');
    expect(html).toContain('id="home-taskcards-heading"');
  });

  it('renders no widget when the payload violates its contract (no title)', async () => {
    const body = confirmedBody();
    const broken = {
      ...body,
      event: { ...body.event, titleFi: '', titleEn: '' },
    };
    const html = await renderHomeWithCalendar({ body: broken });

    expect(calendarWidget(html)).toBeNull();
    expect(html).toContain(
      'Laske alkoholin todellinen kokonaishinta Suomeen',
    );
  });
});

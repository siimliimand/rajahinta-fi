/**
 * Homepage SSR tests (OpenSpec: design-system-foundation, task 4.2;
 * homepage-live-gap-hero task 2.2 extends the file with the live
 * observed-difference section).
 *
 * Renders the REAL server component to an HTML string the way Next's RSC
 * runtime would (only Next server plumbing is mocked), pinning the D6
 * contract: the trust row names the data sources (published retailer
 * datasets and the Alko domestic reference, Vero rate datasets), explains
 * the reliability model by rendering the
 * four canonical statuses from RELIABILITY_STATUS_META, and links to the
 * same methodology destination (/ranking) the header and footer use —
 * all from static catalog copy, with no homepage API dependency.
 *
 * The live gap section pins the D3/D4 degradation split: figures with
 * whole-row /products links and the as-of date only on a fresh
 * successful read; the pending state when no eligible rows exist; the
 * unavailable state on a failed or stale read — no product figures in
 * either degraded state.
 *
 * @module HomePageSsrTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HomePage from './page';
import { SAVINGS_TOP_PATH } from '@/lib/api';
import type { SavingsTopRow } from './components/HomeGapHero';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved straight from the
// Finnish catalog. The root-scoped translator resolves full dotted keys so
// the trust row can consume RELIABILITY_STATUS_META's labelKey contract.
// (Catalogs load via dynamic import inside the factory: vi.mock factories
// are hoisted above static imports.)
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (await import('@/messages/fi.json')).default as Record<
      string,
      unknown
    >;
    return (key: string, values?: Record<string, unknown>) => {
      const value = ns
        ? (table[ns] as Record<string, unknown> | undefined)?.[key]
        : key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            table,
          );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      // Minimal ICU-style {name} interpolation — the live-gap as-of line
      // carries a {date} value; keys without placeholders are untouched.
      return value.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        values && name in values ? String(values[name]) : placeholder,
      );
    };
  },
}));

// The i18n Link is a Next router-aware component; under renderToString it
// renders as a plain anchor with the href it was given (fi needs no prefix).
// The i18n Link double serializes typed href objects through the real
// routing vocabulary (the shared testing double).
vi.mock('@/i18n/navigation', async () => {
  const { TestI18nLink } = await import('@/lib/testing/i18n-navigation');
  return { Link: TestI18nLink };
});

// The accuracy statistic (task 3.3) is a self-contained client island
// with its own fetch and its own test file. This file pins the STATIC
// trust-row copy — stub the island so the SSR render stays offline.
vi.mock('./components/AccuracyStat', () => ({
  default: () => React.createElement('div', { 'data-testid': 'accuracy-trust-row-stub' }),
}));

describe('HomePage trust row (task 4.2, D6)', () => {
  let html = '';

  beforeAll(async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    html = renderToString(element);
  });

  it('renders the hero headline', () => {
    expect(html).toContain(
      'Laske alkoholin todellinen kokonaishinta Suomeen',
    );
  });

  it('names both data sources: published retailer datasets with the Alko reference, and Vero rate datasets', () => {
    expect(html).toContain('Aineistolähteet');
    expect(html).toContain(
      'vähittäismyyjien julkaisemiin aineistoihin ja Alkon kotimaiseen vertailuhintaan',
    );
    expect(html).toContain('Verohallinnon virallisiin verokanta-aineistoihin');
  });

  it('explains the reliability model and lists the four canonical statuses', () => {
    expect(html).toContain('Luotettavuusmerkinnät');
    expect(html).toContain(
      'Jokainen näytetty luku kantaa luotettavuusmerkinnän ja aikaleiman',
    );
    // All four RELIABILITY_STATUS_META labels resolve through their
    // labelKey — a missing catalog key would render __MISSING__.
    expect(html).toContain('Vahvistettu');
    expect(html).toContain('Arvioitu');
    expect(html).toContain('Vanhentunut');
    expect(html).toContain('Ei saatavilla');
    expect(html).not.toContain('__MISSING_');
  });

  it('links the methodology item to /ranking, the shared methodology route', () => {
    expect(html).toContain('Menetelmä');
    expect(html).toContain('href="/ranking"');
    expect(html).toContain('Järjestysperiaatteet');
  });
});

// ---------------------------------------------------------------------------
// Live observed-difference section (homepage-live-gap-hero task 2.2).
// The page's top-N fetch goes through global fetch, so each scenario
// stubs it by URL: /api/v1/savings/top answers the scenario body, every
// other server fetch (overview, guides) fails and degrades — the render
// stays fully offline and the section's D3/D4 states are pinned in
// isolation. No figures may ever render in the degraded states.
// ---------------------------------------------------------------------------

/** The URL substring that identifies the hero's savings read. */
const HERO_READ_URL = SAVINGS_TOP_PATH;

/** Half a day ago at day grain — always inside the 3-day cutoff (D4). */
const FRESH_DAY = new Date(Date.now() - 12 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

/**
 * The expected fi-FI rendering of the fresh day — computed with the
 * component's own construction (new Date + fi-FI toLocaleDateString),
 * so the pin holds under whatever ICU data the runtime carries.
 */
const FRESH_DAY_DISPLAY = new Date(`${FRESH_DAY}T00:00:00.000Z`).toLocaleDateString(
  'fi-FI',
  { year: 'numeric', month: 'short', day: 'numeric' },
);

function topRow(overrides: Partial<SavingsTopRow> = {}): SavingsTopRow {
  return {
    productId: 101,
    productName: 'Testiviini 201',
    category: 'wine',
    merchant: 'Testikauppa',
    merchantCountry: 'EE',
    priceCents: 1999,
    observedAt: `${FRESH_DAY}T10:00:00.000Z`,
    landedTotalCents: 2143,
    alkoReferenceCents: 3099,
    alkoObservedAt: `${FRESH_DAY}T00:00:00.000Z`,
    gapCents: -956,
    gapBasisPoints: -3085,
    reliability: 'COMPUTED',
    confidence: 'HIGH',
    taxDatasetVersion: 'rates-2024.1',
    ...overrides,
  };
}

type ReadStub = { readonly body: unknown } | 'fail';

/** Render the homepage HTML with the savings read answering `read`, rest offline. */
async function renderHomeWithRead(read: ReadStub): Promise<string> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url =
        typeof input === 'string'
          ? input
          : String((input as { url?: unknown })?.url ?? input);
      if (url.includes(HERO_READ_URL)) {
        if (read === 'fail') throw new Error('savings read failed (mocked)');
        return { ok: true, status: 200, json: async () => read.body };
      }
      // Every other server read degrades: non-ok → null / unavailable.
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

/** The rendered live section element, or null when it did not render. */
function liveGapSection(html: string): HTMLElement | null {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container.querySelector<HTMLElement>('[data-testid="home-gap-hero"]');
}

describe('HomePage live gap section (homepage-live-gap-hero task 2.2)', () => {
  it('renders live rows with whole-row /products links and the as-of date', async () => {
    const html = await renderHomeWithRead({
      body: {
        asOf: FRESH_DAY,
        coverage: { evaluated: 10, importFavourable: 2, listed: 2 },
        rows: [
          topRow(),
          topRow({
            productId: 202,
            productName: 'Testiolut 402',
            category: 'beer',
            priceCents: 349,
            landedTotalCents: 512,
            alkoReferenceCents: 749,
            gapCents: -237,
            gapBasisPoints: -3164,
          }),
        ],
      },
    });

    const section = liveGapSection(html);
    expect(section).not.toBeNull();

    // Each row is ONE whole-row link to the product detail page (D6):
    // the product anchor stretches over the row via the /savings
    // listing's Safari-safe ::after construction.
    for (const id of [101, 202]) {
      const link = section?.querySelector<HTMLAnchorElement>(
        `a[href="/tuotteet/${id}"]`,
      );
      expect(link).not.toBeNull();
      expect(link?.className).toContain('after:absolute');
      expect(link?.className).toContain('after:inset-0');
    }

    // Figures and as-of provenance render (D4); the gap is the signed
    // euro difference, negative = cheaper than the reference.
    expect(section?.textContent).toContain('Testiviini 201');
    expect(section?.textContent).toContain('21.43 €');
    expect(section?.textContent).toContain('30.99 €');
    expect(section?.textContent).toContain('-9.56 €');
    expect(section?.textContent).toContain(FRESH_DAY_DISPLAY);

    // The link is a navigation affordance only — the API's
    // deterministic order is preserved.
    const text = section?.textContent ?? '';
    expect(text.indexOf('Testiviini 201')).toBeLessThan(
      text.indexOf('Testiolut 402'),
    );
  });

  it('renders the pending state — no figures — when no eligible rows exist', async () => {
    const html = await renderHomeWithRead({
      body: {
        asOf: FRESH_DAY,
        coverage: { evaluated: 10, importFavourable: 0, listed: 0 },
        rows: [],
      },
    });

    const section = liveGapSection(html);
    expect(section?.querySelector('[data-testid="home-gap-hero-pending"]'))
      .not.toBeNull();
    expect(section?.textContent).toContain(
      'Päivän vertailua ei ole vielä koostettu.',
    );
    // The honest pointer into the current listing.
    expect(section?.querySelector('a[href="/savings"]')).not.toBeNull();
    expect(section?.textContent).toContain(
      'Kokonaishinta-ero Alko-viitehintaan',
    );

    // No product figures render in the pending state.
    expect(html).not.toContain('href="/tuotteet/');
    expect(section?.textContent).not.toContain('21.43 €');
    expect(section?.textContent).not.toContain('-9.56 €');
  });

  it('renders the pending state when the day has rows but no as-of', async () => {
    const html = await renderHomeWithRead({
      body: {
        asOf: null,
        coverage: { evaluated: 10, importFavourable: 1, listed: 1 },
        rows: [topRow()],
      },
    });

    const section = liveGapSection(html);
    expect(section?.querySelector('[data-testid="home-gap-hero-pending"]'))
      .not.toBeNull();
    // No figures: a row without its day cannot be presented as current.
    expect(html).not.toContain('href="/tuotteet/');
    expect(section?.textContent).not.toContain('Testiviini 201');
    expect(section?.textContent).not.toContain('21.43 €');
  });

  it('renders the unavailable state — no figures — when the savings read fails', async () => {
    const html = await renderHomeWithRead('fail');

    const section = liveGapSection(html);
    expect(section?.querySelector('[data-testid="home-gap-hero-unavailable"]'))
      .not.toBeNull();
    expect(section?.textContent).toContain(
      'Päivän vertailua ei voitu ladata juuri nyt.',
    );

    // No product figures render in the unavailable state.
    expect(html).not.toContain('href="/tuotteet/');
    expect(section?.textContent).not.toContain('Testiviini 201');
    expect(section?.textContent).not.toContain('21.43 €');
    expect(section?.textContent).not.toContain('-9.56 €');
  });

  it('renders the unavailable state — no figures — when the snapshot day is older than the freshness cutoff', async () => {
    const html = await renderHomeWithRead({
      body: {
        asOf: '2020-01-01',
        coverage: { evaluated: 10, importFavourable: 1, listed: 1 },
        rows: [topRow()],
      },
    });

    const section = liveGapSection(html);
    expect(section?.querySelector('[data-testid="home-gap-hero-unavailable"]'))
      .not.toBeNull();
    // Stale figures never headline as current (D4).
    expect(html).not.toContain('href="/tuotteet/');
    expect(section?.textContent).not.toContain('Testiviini 201');
    expect(section?.textContent).not.toContain('21.43 €');
    expect(section?.textContent).not.toContain('-9.56 €');
  });
});

/**
 * Homepage worked-example step-strip tests (homepage-live-gap-hero
 * task 2.3, demoting the price-intelligence-roadmap task 3.1 D7
 * breakdown).
 *
 * Renders the REAL server component to an HTML string (page.ssr.test.tsx
 * precedent; only Next server plumbing is mocked). The demoted section
 * is a compact "how it works" step strip BELOW the live section, with
 * FIXED illustrative figures labeled as an example — no API call,
 * fully crawlable, unable to drift with live data — so the pins are:
 *
 *   1. The section renders server-side with the example labeling
 *      ("Esimerkkilaskelma") and the how-it-works heading present.
 *   2. The three step labels interpolate ({step} → Vaihe 1..3) and the
 *      fixed example figures with the explicit difference wording
 *      (cheaper, in words — never color-alone) are in the HTML.
 *   3. The strip sits below the live observed-difference section in
 *      DOM order (the demoted placement, spec scenario "Example is
 *      demoted below the live section").
 *   4. The render is static: every server fetch fails loudly, yet the
 *      strip renders complete — it depends on no API response.
 *
 * @module HomePageExampleTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

// The static example section must not depend on the guides fetch; mock
// it like page.faq.test.tsx so this render stays fully offline and the
// example section is proven independent of any API response.
vi.mock('./guides/guides.server', () => ({
  getServerGuidesIndex: vi.fn(async () => ({ kind: 'error' as const })),
}));

// Mocked Next server plumbing — next-intl/server resolved straight from
// the Finnish catalog, with the same minimal ICU-style {name}
// interpolation page.ssr.test.tsx carries (the demoted step strip's
// exampleStepLabel needs {step}). The root-scoped translator resolves
// full dotted keys so the trust row can consume
// RELIABILITY_STATUS_META's labelKey contract.
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
      return value.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
        values && name in values ? String(values[name]) : placeholder,
      );
    };
  },
}));

// The i18n Link renders as a plain anchor under renderToString.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement(
      'a',
      { ...rest, href: String(href ?? '') },
      children,
    );
  },
}));

// The accuracy statistic (task 3.3) is a client island with its own
// fetch; stub it so this SSR render stays offline (page.ssr.test.tsx
// precedent).
vi.mock('./components/AccuracyStat', () => ({
  default: () => React.createElement('div', { 'data-testid': 'accuracy-trust-row-stub' }),
}));

describe('HomePage worked example — demoted step strip (homepage-live-gap-hero task 2.3)', () => {
  let html = '';
  // Every server read throws: the strip must render complete anyway.
  const fetchMock = vi.fn(async () => {
    throw new Error('homepage worked example must not fetch');
  });

  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    const element = await HomePage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    html = renderToString(element);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('renders the section server-side with the example labeling and the how-it-works heading', () => {
    expect(html).toContain('Esimerkkilaskelma');
    expect(html).toContain('home-example-heading');
    // The compact strip is the how-it-works section; the concrete
    // worked case (the old heading) survives as its descriptive line.
    expect(html).toContain('Näin se toimii');
    expect(html).toContain('Näin kokonaishinta muodostuu: 6 pulloa viiniä Tallinnasta');
  });

  it('carries the three interpolated step labels in order', () => {
    // {step} must be interpolated, never leaked raw.
    expect(html).toContain('Vaihe 1');
    expect(html).toContain('Vaihe 2');
    expect(html).toContain('Vaihe 3');
    expect(html).not.toContain('{step}');

    const page = document.createElement('div');
    page.innerHTML = html;
    const section = page.querySelector(
      'section[aria-labelledby="home-example-heading"]',
    );
    const steps = section
      ? Array.from(section.querySelectorAll('ol > li'))
      : [];
    expect(steps).toHaveLength(3);
    expect(steps.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Vaihe 1'),
      expect.stringContaining('Vaihe 2'),
      expect.stringContaining('Vaihe 3'),
    ]);
  });

  it('carries the fixed example figures and the explicit cheaper/dearer wording', () => {
    expect(html).toContain('6 pulloa viiniä Tallinnasta');
    expect(html).toContain('48,00 €');
    expect(html).toContain('15,00 €');
    expect(html).toContain('63,00 €');
    expect(html).toContain('96,00 €');
    // The difference is spelled out in words (cheaper), never carried by
    // color alone.
    expect(html).toContain('edullisempi');
    // The note keeps the estimates stance and the dearer possibility.
    expect(html).toContain('kuvitteellisia');
    expect(html).toContain('kalliimpi');
  });

  it('renders below the live section in DOM order (the demoted placement)', () => {
    const page = document.createElement('div');
    page.innerHTML = html;
    const live = page.querySelector('[data-testid="home-gap-hero"]');
    const example = page.querySelector(
      'section[aria-labelledby="home-example-heading"]',
    );
    expect(live).not.toBeNull();
    expect(example).not.toBeNull();
    // `example` follows `live` in the document order.
    expect(
      live!.compareDocumentPosition(example!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('renders statically: no __MISSING__ catalog keys, no fetch dependence', () => {
    // The stub was active during the render (the page attempted its
    // server reads and every one failed) — the strip is complete
    // regardless, proving it consumes no API response.
    expect(fetchMock).toHaveBeenCalled();
    // Every example key resolved from the catalog.
    expect(html).not.toContain('__MISSING_');
    expect(html).toContain('Esimerkkilaskelma');
    expect(html).toContain('63,00 €');
  });
});

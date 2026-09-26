/**
 * Homepage worked-example section tests (price-intelligence-roadmap
 * task 3.1, D7).
 *
 * Renders the REAL server component to an HTML string (page.ssr.test.tsx
 * precedent; only Next server plumbing is mocked). The section ships
 * FIXED illustrative figures labeled as an example — no API call, fully
 * crawlable, unable to drift with live data — so the pins are:
 *
 *   1. The section renders server-side with the example labeling
 *      ("Esimerkkilaskelma") present.
 *   2. The fixed example figures and the explicit difference wording
 *      (cheaper, in words — never color-alone) are in the HTML.
 *   3. The render is static: no API request is involved in producing
 *      the section (the guides fetch is mocked away; the section does
 *      not depend on it either way).
 *
 * @module HomePageExampleTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

// The static example section must not depend on the guides fetch; mock
// it like page.faq.test.tsx so this render stays fully offline and the
// example section is proven independent of any API response.
vi.mock('./guides/guides.server', () => ({
  getServerGuidesIndex: vi.fn(async () => ({ kind: 'error' as const })),
}));

// Mocked Next server plumbing — next-intl/server resolved straight from
// the Finnish catalog. The root-scoped translator resolves full dotted
// keys so the trust row can consume RELIABILITY_STATUS_META's labelKey
// contract (page.ssr.test.tsx precedent).
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
    return (key: string) => {
      const value = ns
        ? (table[ns] as Record<string, unknown> | undefined)?.[key]
        : key.split('.').reduce<unknown>(
            (node, part) => (node as Record<string, unknown> | undefined)?.[part],
            table,
          );
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
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

describe('HomePage worked example (task 3.1, D7)', () => {
  let html = '';

  beforeAll(async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    html = renderToString(element);
  });

  it('renders the section server-side with the example labeling present', () => {
    expect(html).toContain('Esimerkkilaskelma');
    expect(html).toContain('home-example-heading');
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

  it('renders statically: no __MISSING__ catalog keys, no fetch dependence', () => {
    // Every example key resolved from the catalog.
    expect(html).not.toContain('__MISSING_');
    // The guides fetch failed (mocked error) and the section still
    // renders — the example is independent of any API response.
    expect(html).toContain('Esimerkkilaskelma');
  });
});

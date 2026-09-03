/**
 * Homepage SSR tests (OpenSpec: design-system-foundation, task 4.2).
 *
 * Renders the REAL server component to an HTML string the way Next's RSC
 * runtime would (only Next server plumbing is mocked), pinning the D6
 * contract: the trust row names the data sources (Systembolaget feed,
 * Vero rate datasets), explains the reliability model by rendering the
 * four canonical statuses from RELIABILITY_STATUS_META, and links to the
 * same methodology destination (/ranking) the header and footer use —
 * all from static catalog copy, with no homepage API dependency.
 *
 * @module HomePageSsrTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

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

// The i18n Link is a Next router-aware component; under renderToString it
// renders as a plain anchor with the href it was given (fi needs no prefix).
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

describe('HomePage trust row (task 4.2, D6)', () => {
  let html = '';

  beforeAll(async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: 'fi' }),
    });
    html = renderToString(element);
  });

  it('renders the hero value prop unchanged', () => {
    expect(html).toContain(
      'Laske alkoholijuomien tuonnin kokonaiskustannus Ruotsista ja muualta Euroopasta Suomeen',
    );
  });

  it('names both data sources: the Systembolaget feed and Vero rate datasets', () => {
    expect(html).toContain('Aineistolähteet');
    expect(html).toContain('Systembolagetin ja muiden eurooppalaisten vähittäismyyjien');
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
    expect(html).toContain('Miten järjestäminen toimii');
  });
});

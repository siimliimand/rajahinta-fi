/**
 * About + Contact page tests (task 3.3, change
 * price-intelligence-roadmap).
 *
 * Renders the REAL async server components the way Next's RSC runtime
 * would (the savings/blog server-shell test precedent: only Next server
 * plumbing is mocked). Pinned here:
 *
 *   About (/about):
 *   1. The page renders its sections from the fi catalog.
 *   2. generateMetadata emits its own (unique) title/description.
 *
 *   Contact (/contact):
 *   3. The page renders AND names the data-correction mechanism —
 *      the calculator page's "Ilmoita virheestä" control and its
 *      operator-resolved review queue — copy-level, no form of its own.
 *   4. generateMetadata emits its own (unique) title/description.
 *
 * @module AboutContactPagesTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import AboutPage, { generateMetadata as aboutMetadata } from './about/page';
import ContactPage, { generateMetadata as contactMetadata } from './contact/page';

// Mocked Next server plumbing — next-intl/server resolved straight from
// the Finnish catalog, with {param} interpolation (blog-pages precedent).
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
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      return values === undefined
        ? value
        : value.replace(/\{(\w+)\}/g, (_, k: string) =>
            values[k] === undefined ? `{${k}}` : String(values[k]),
          );
    };
  },
}));

async function renderPageHtml(
  element: Promise<React.ReactElement>,
): Promise<string> {
  const messages = (await import('@/messages/fi.json')).default;
  return renderToString(
    <NextIntlClientProvider locale="fi" messages={messages}>
      {await element}
    </NextIntlClientProvider>,
  );
}

describe('AboutPage (task 3.3)', () => {
  it('renders the service description sections from the fi catalog', async () => {
    const html = await renderPageHtml(
      AboutPage({ params: Promise.resolve({ locale: 'fi' }) }),
    );

    expect(html).toContain('Tietoja Rajahinta.fi:stä');
    expect(html).toContain('Mitä palvelu tekee');
    expect(html).toContain('Mistä tiedot tulevat');
    // The estimates-not-advice stance stays on the page.
    expect(html).toContain('ei tarjoa vero- tai tullineuvontaa');
  });

  it('emits unique metadata', async () => {
    const meta = await aboutMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Tietoja Rajahinta.fi:stä');
    expect(meta.description).toContain('Mikä Rajahinta.fi on');
  });
});

describe('ContactPage (task 3.3)', () => {
  it('renders and mentions the data-correction mechanism', async () => {
    const html = await renderPageHtml(
      ContactPage({ params: Promise.resolve({ locale: 'fi' }) }),
    );

    expect(html).toContain('Yhteystiedot');
    // The mechanism is named the way the calculator names its control,
    // and its operator-resolved, audit-trailed review is stated.
    expect(html).toContain('Ilmoita tietojen oikaisusta');
    expect(html).toContain('Ilmoita virheestä');
    expect(html).toContain('tarkastusjonoon');
    expect(html).toContain('operaattorin tunnuksella ja aikaleimalla');
  });

  it('emits unique metadata distinct from the About page', async () => {
    const meta = await contactMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Yhteystiedot');
    expect(meta.description).toContain('oikaisusta');
  });
});

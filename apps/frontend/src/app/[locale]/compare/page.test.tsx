/**
 * Compare page tests (price-intelligence-roadmap task 2.2).
 *
 * Server-shell tests pin the D2 conversion (calculator page.test.tsx
 * precedent): the page owns unique metadata and server-renders the intro
 * + "how this comparison works" summary in the server HTML.
 *
 * @module ComparePageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import ComparePage, { generateMetadata as compareMetadata } from './page';

// The server shell (page.tsx) resolves its copy through next-intl/server;
// resolve straight from the Finnish catalog (calculator test precedent).
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
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
      return typeof value === 'string' ? value : `__MISSING_${ns}.${key}__`;
    };
  },
}));

// The comparison view is stubbed for the SSR test: unlike the calculator
// tree, some of its components predate the repo's React-namespace-import
// convention, so they cannot render under vitest's classic-JSX transform.
// The server-shell test pins the crawlable server HTML; the interactive
// flow is exercised by its own unit tests.
vi.mock('./compare-view', async () => {
  const React = await import('react');
  return {
    default: () =>
      React.createElement('div', { 'data-testid': 'compare-view-stub' }),
  };
});

describe('ComparePage server shell (task 2.2)', () => {
  it('emits unique metadata with the side-by-side comparison framing', async () => {
    const meta = await compareMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Tuotevertailu: kokonaiskustannukset rinnakkain');
    expect(meta.description).toContain('rinnakkain');
    // Unique against the site-default metadata title, not a restatement.
    const root = (await import('@/messages/fi.json')).default as {
      Metadata: { title: string };
    };
    expect(meta.title).not.toBe(root.Metadata.title);
  });

  it('server-renders the intro and the how-this-comparison-works summary', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await ComparePage({ params: Promise.resolve({ locale: 'fi' }) })}
      </NextIntlClientProvider>,
    );

    expect(html).toContain('Tuotevertailu');
    expect(html).toContain('Miten vertailu toimii');
    // The neutrality stance holds in the crawlable summary.
    expect(html).toContain('kaupallisiin tekijöihin');
  });
});

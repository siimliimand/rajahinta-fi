/**
 * Basket page tests (price-intelligence-roadmap task 2.2).
 *
 * Server-shell tests pin the D2 conversion (calculator page.test.tsx
 * precedent): the page owns unique metadata and server-renders the intro
 * + "how this optimization works" summary in the server HTML.
 *
 * @module BasketPageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import BasketPage, { generateMetadata as basketMetadata } from './page';

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

// The basket view is stubbed for the SSR test: unlike the calculator
// tree, some of its components predate the repo's React-namespace-import
// convention, so they cannot render under vitest's classic-JSX transform.
// The server-shell test pins the crawlable server HTML; the interactive
// flow is exercised by its own unit tests.
vi.mock('./basket-view', async () => {
  const React = await import('react');
  return {
    default: () =>
      React.createElement('div', { 'data-testid': 'basket-view-stub' }),
  };
});

describe('BasketPage server shell (task 2.2)', () => {
  it('emits unique metadata with the multi-item basket framing', async () => {
    const meta = await basketMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe(
      'Ostoskorin optimointi: usean tuotteen kokonaiskustannus',
    );
    expect(meta.description).toContain('myyjäyhdistelmästä');
    // Unique against the site-default metadata title, not a restatement.
    const root = (await import('@/messages/fi.json')).default as {
      Metadata: { title: string };
    };
    expect(meta.title).not.toBe(root.Metadata.title);
  });

  it('server-renders the intro and the how-this-optimization-works summary', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await BasketPage({ params: Promise.resolve({ locale: 'fi' }) })}
      </NextIntlClientProvider>,
    );

    expect(html).toContain('Ostoskorin optimointi');
    expect(html).toContain('Miten optimointi toimii');
    // The estimates stance holds — the summary is content, not advice.
    expect(html).toContain('Tulos on aina arvio');
  });
});

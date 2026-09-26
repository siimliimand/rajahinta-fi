/**
 * Ranking page tests (price-intelligence-roadmap task 2.4).
 *
 * Server-shell tests pin the D2 conversion (calculator page.test.tsx
 * precedent): the page owns unique metadata and server-renders the intro
 * + "how the orderings are formed" summary in the server HTML.
 *
 * @module RankingPageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import RankingPage, { generateMetadata as rankingMetadata } from './page';

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

// The methodology view renders i18n navigation Links; the router-aware
// navigation module does not load under this test environment, so stub it
// with the plain-anchor shape every other page test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

// The accuracy island fetches its own statistic; the SSR render pins the
// static shell copy, so the fetch must stay offline.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, getAccuracyStatistic: vi.fn() };
});

describe('RankingPage server shell (task 2.4)', () => {
  it('emits unique metadata with the neutral-ranking framing', async () => {
    const meta = await rankingMetadata({
      params: Promise.resolve({ locale: 'fi' }),
    });
    expect(meta.title).toBe('Järjestäminen: objektiivinen, avoin ja neutraali');
    expect(meta.description).toContain('objektiivisiin tekijöihin');
    // Unique against the site-default metadata title, not a restatement.
    const root = (await import('@/messages/fi.json')).default as {
      Metadata: { title: string };
    };
    expect(meta.title).not.toBe(root.Metadata.title);
  });

  it('server-renders the intro and the how-the-orderings-are-formed summary', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await RankingPage({ params: Promise.resolve({ locale: 'fi' }) })}
      </NextIntlClientProvider>,
    );

    expect(html).toContain('Miten järjestäminen toimii');
    expect(html).toContain('Miten järjestykset muodostuvat');
    // The neutrality stance holds in the crawlable summary.
    expect(html).toContain('myyjän maksu tai manuaalinen korostus');
  });
});

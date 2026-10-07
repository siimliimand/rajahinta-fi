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
    expect(meta.title).toBe('Miten järjestys muodostuu');
    expect(meta.description).toContain('saman järjestyksen');
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

    expect(html).toContain('Miten järjestys muodostuu');
    expect(html).toContain('Miten järjestykset muodostuvat');
    // The neutrality stance holds in the crawlable summary.
    expect(html).toContain('myyjän maksu tai manuaalinen korostus');
  });

  it('renders the methodology in consumer register with every enforcement fact stated', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await RankingPage({ params: Promise.resolve({ locale: 'fi' }) })}
      </NextIntlClientProvider>,
    );

    // The consumer sentence leads (R1); no engineering-noun badge or label.
    expect(html).toContain('Sama aineisto tuottaa aina saman järjestyksen');
    expect(html).not.toContain('Deterministinen:');
    expect(html).not.toContain('Rajattu syöte');
    expect(html).not.toContain('Testeillä lukittu muoto');
    expect(html).not.toContain('Odottamattoman tiedon hylkäys');

    // The three enforcement layers keep their checkable claims (R3):
    // bounded input with no paid-placement field, test-pinned shape, and
    // unknown-field rejection.
    expect(html).toContain('kenttää maksullista sijoittelua varten ei ole olemassa');
    expect(html).toContain('Laskenta näkee vain olennaisen tiedon');
    expect(html).toContain('Automaattiset testit lukitsevat syötteen muodon');
    expect(html).toContain('hiljainen muutos ei pääse käyttöön asti');
    expect(html).toContain('Tuntematon tieto pysäyttää laskennan');
    expect(html).toContain('eikä ohita kenttää hiljaisesti');
  });
});

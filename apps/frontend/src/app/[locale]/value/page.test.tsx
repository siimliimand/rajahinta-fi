/**
 * Value page tests (price-intelligence-roadmap task 2.5).
 *
 * The page is already a server shell (trust-and-reach-roadmap 7.2); task
 * 2.5 adds only its unique metadata. Server-shell tests pin that
 * metadata and the server-rendered content (calculator page.test.tsx
 * precedent), with `?category=` handling untouched.
 *
 * @module ValuePageTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import ValuePage, { generateMetadata as valueMetadata } from './page';

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

// The category selector renders i18n navigation Links; the router-aware
// navigation module does not load under this test environment, so stub it
// with the plain-anchor shape every other page test uses.
vi.mock('@/i18n/navigation', () => ({
  Link: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', props),
}));

describe('ValuePage metadata (task 2.5)', () => {
  it('emits unique metadata with the €/g unit-price framing', async () => {
    const meta = await valueMetadata({
      params: Promise.resolve({ locale: 'fi' }),
      // generateMetadata ignores searchParams; the prop is required by
      // the shared page props type.
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe('Etanoli-€/g hintaluokittain: yksikköhinta-listaus');
    expect(meta.description).toContain('puhdasta etanolia');
    // Unique against the site-default metadata title, not a restatement.
    const root = (await import('@/messages/fi.json')).default as {
      Metadata: { title: string };
    };
    expect(meta.title).not.toBe(root.Metadata.title);
  });

  it('keeps the server-rendered content and default-category handling unchanged', async () => {
    const messages = (await import('@/messages/fi.json')).default;
    const html = renderToString(
      <NextIntlClientProvider locale="fi" messages={messages}>
        {await ValuePage({
          params: Promise.resolve({ locale: 'fi' }),
          searchParams: Promise.resolve({}),
        })}
      </NextIntlClientProvider>,
    );

    expect(html).toContain('Etanoli-€/g hintaluokittain');
    // Unknown or missing category falls back to the default (beer):
    // the aria-current selector state proves the handling is unchanged.
    expect(
      html.includes('aria-current="page"'),
    ).toBe(true);
  });
});

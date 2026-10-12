/**
 * FI product tree layout SSR test (fi-path-isr task 3.2).
 *
 * The middleware-bypassed Finnish tree keeps its own document root
 * (`app/tuotteet/[id]/layout.tsx` — there is deliberately no shared
 * `app/layout.tsx`; see LocaleChrome's docblock), so the tree's `lang`
 * correctness rests on exactly one fact: this layout delegates the
 * document to the shared LocaleChrome with the pinned locale 'fi'.
 * Rendered here the way the server would — only Next server plumbing
 * mocked, the same harness shape as `[locale]/layout.ssr.test.tsx`,
 * whose composition tests pin the LocaleChrome mechanism itself (the
 * `<html lang>` rendered from the explicit locale prop) for the
 * [locale] tree, /en/... included. This file applies that mechanism to
 * the FI tree: `fi` on /tuotteet/<id>.
 *
 * @module FiProductLayoutSsrTest
 */
// @vitest-environment jsdom

import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FiProductLayout from './layout';
import LocaleChrome from '@/app/_chrome/LocaleChrome';

// The layout primes the request locale before the chrome renders; the
// real next-intl server API needs a request store vitest lacks — stub,
// as in every layout/page SSR harness.
vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
}));

// next/font/google is a Next build-time transform with no runtime under
// vitest — same stub shape as layout.ssr.test.tsx.
vi.mock('next/font/google', () => ({
  Inter: () => Object.assign(() => null, { variable: '__variable_mock_inter' }),
}));

// The ui primitives (LocaleChrome renders AgeGate → Button) ship
// Next-automatic JSX while vitest's esbuild transform emits classic
// React.createElement — same global exposure as layout.ssr.test.tsx.
(globalThis as { React?: typeof React }).React = React;

// Chrome-only render: the header/footer markers (SiteFooter is an async
// server component that cannot pass through renderToString), exactly as
// in the [locale] harnesses.
vi.mock('@/app/[locale]/components/SiteHeader', () => ({
  default: () =>
    React.createElement('header', { 'data-testid': 'site-header' }, 'CHROME-HEADER'),
}));
vi.mock('@/app/[locale]/components/SiteFooter', () => ({
  default: () =>
    React.createElement('footer', { 'data-testid': 'site-footer' }, 'CHROME-FOOTER'),
}));

// AgeGate resolves its declined-route path through the i18n navigation
// primitives, which cannot load under vitest — stubbed like the
// [locale] harnesses so the render stays offline.
vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement('a', { ...rest, href: String(href ?? '') }, children);
  },
  usePathname: () => '/',
  useRouter: () => ({ replace: () => undefined }),
}));

// Real module, only `request` mocked — keeps the chrome render offline
// while the rest of the export surface keeps its real shape.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

describe('FI product tree layout SSR (fi-path-isr 3.2)', () => {
  it('delegates the document to LocaleChrome with the pinned fi locale', async () => {
    const element = (await FiProductLayout({
      children: <div data-testid="page-body">PAGE-BODY-MARKER</div>,
    })) as React.ReactElement<{ locale: string; children: React.ReactNode }>;

    // The delegation IS the lang contract's mechanism: LocaleChrome
    // renders <html lang={locale}> from the explicit prop (the
    // mechanism itself is pinned in [locale]/layout.ssr.test.tsx). The
    // layout must pass the pinned 'fi' — never a request-derived
    // locale, which would opt the tree back into dynamic rendering.
    expect(element.type).toBe(LocaleChrome);
    expect(element.props.locale).toBe('fi');

    const html = renderToString(await LocaleChrome(element.props));
    // Anchored to the document element: the FI tree's first HTML is
    // Finnish, the same way /en/... is English (pinned there).
    expect(html).toContain('<html lang="fi"');
    expect(html).not.toContain('lang="en"');
    expect(html).toContain('PAGE-BODY-MARKER');
    // Every catalog key resolved.
    expect(html).not.toContain('__MISSING_');
  });
});

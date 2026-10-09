/**
 * Test double for the i18n navigation primitives (change
 * localize-fi-route-pathnames).
 *
 * The real `@/i18n/navigation` cannot load under vitest (it pulls in
 * `next/navigation`), so page tests mock the module with a Link that
 * renders a plain anchor. Since the typed hrefs are now OBJECTS
 * (`{ pathname: '/products', query: { … } }`), that mock must
 * serialize them the way next-intl's Link does — localized segment,
 * query string, hash — or every href assertion reads
 * `[object Object]`.
 *
 * This module resolves hrefs against the REAL `routing.pathnames`
 * vocabulary (fi template, bare — fi is the default locale under
 * `localePrefix: 'as-needed'`), so the mock cannot drift from the
 * config either. Tests rendering the EN locale wrap the result with
 * their own `/en` prefix through `createTestI18nLink`.
 *
 * @module lib/testing/i18n-navigation
 */

import * as React from 'react';
import { routing } from '@/i18n/routing';

/**
 * Serialize a typed href (string or next-intl-shaped object) to the
 * URL string the real Link would render for the default locale.
 */
export function testHrefToString(href: unknown): string {
  if (typeof href === 'string') return href;
  const {
    pathname,
    params,
    query,
    hash,
  } = href as {
    pathname?: keyof typeof routing.pathnames;
    params?: Record<string, string | number | boolean>;
    query?: Record<string, string | number | undefined>;
    hash?: string;
  };
  const template = pathname === undefined ? '' : routing.pathnames[pathname];
  let path = typeof template === 'string' ? template : template.fi;
  for (const [key, value] of Object.entries(params ?? {})) {
    path = path.replaceAll(`[${key}]`, String(value));
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const queryString = search.toString();
  return `${path}${queryString === '' ? '' : `?${queryString}`}${hash ?? ''}`;
}

/** Anchor-rendering Link double for the fi (bare-URL) assertions. */
export const TestI18nLink = createTestI18nLink(() => 'fi');

/**
 * Link double localized for the locale the given getter returns —
 * `localePrefix: 'as-needed'` shape: fi stays bare, en gets `/en`.
 * The getter indirection serves the hoisted-state mocks
 * (crawlability.test.tsx precedent) that steer the locale per test.
 */
export function createTestI18nLink(
  getLocale: () => string,
): (props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>) => React.ReactElement {
  return (props) => {
    const { href, children, ...rest } = props;
    const base = testHrefToString(href ?? '');
    const target =
      getLocale() === 'en' && base.startsWith('/') ? `/en${base}` : base;
    return React.createElement('a', { ...rest, href: target }, children);
  };
}

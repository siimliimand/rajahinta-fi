/**
 * @vitest-environment jsdom
 */
/**
 * Segment layout tests for the tax-change calendar routes (task 4.5,
 * change tax-change-calendar).
 *
 * The route-namespaces contract (`@/lib/i18n/route-namespaces`): every
 * `ROUTE_CLIENT_NAMESPACES` entry MUST have a segment `layout.tsx`
 * rendering the nested message provider with the route's entry — the
 * `/value` layout precedent. Without it the page island resolves against
 * the root layout's chrome subset only and renders fallback text in
 * production. The payload-budget enumeration tripwire pins entry ⇔
 * client tree, not layout presence, so these tests pin the two calendar
 * layouts directly: the provider carries exactly the route's entry —
 * `TaxChangeCalendarPage` straight from the production catalogs — and a
 * client consumer under the provider resolves real copy, not key paths.
 *
 * @module CalendarRouteLayoutTest
 */

import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { describe, expect, it } from 'vitest';
import VeroMuutoksetRouteLayout from './layout';
import TaxChangesRouteLayout from '../tax-changes/layout';
import { ROUTE_CLIENT_NAMESPACES } from '@/lib/i18n/route-namespaces';
import fiMessages from '@/messages/fi.json';
import enMessages from '@/messages/en.json';

/** Segment layout component type (payload-budget.test.tsx precedent). */
type RouteLayout = (props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) => Promise<React.ReactElement>;

type ProviderProps = {
  locale: string;
  messages: Record<string, unknown>;
  children: React.ReactNode;
};

const LAYOUTS: ReadonlyArray<{ route: string; Layout: RouteLayout }> = [
  { route: '/veromuutokset', Layout: VeroMuutoksetRouteLayout as RouteLayout },
  { route: '/tax-changes', Layout: TaxChangesRouteLayout as RouteLayout },
];

function catalog(locale: 'fi' | 'en'): Record<string, unknown> {
  return (locale === 'en' ? enMessages : fiMessages) as Record<string, unknown>;
}

describe.each(LAYOUTS)(
  'segment layout for $route (task 4.5 — the /value precedent)',
  ({ route, Layout }) => {
    it.each(['fi', 'en'] as const)(
      'renders the nested provider carrying exactly the route entry (%s)',
      async (locale) => {
        const sentinel = React.createElement('main');
        const element = await Layout({
          children: sentinel,
          params: Promise.resolve({ locale }),
        });

        expect(element.type).toBe(NextIntlClientProvider);
        const props = element.props as ProviderProps;
        expect(props.locale).toBe(locale);
        expect(Object.keys(props.messages)).toEqual([
          ...ROUTE_CLIENT_NAMESPACES[
            route as keyof typeof ROUTE_CLIENT_NAMESPACES
          ],
        ]);
        expect(props.messages.TaxChangeCalendarPage).toEqual(
          catalog(locale).TaxChangeCalendarPage,
        );
        // Replace semantics: the page subtree renders under THIS
        // provider, passed through untouched.
        expect(props.children).toBe(sentinel);
      },
    );

    it.each(['fi', 'en'] as const)(
      'client island under the provider resolves real copy, not key paths (%s)',
      async (locale) => {
        const expected = (
          catalog(locale).TaxChangeCalendarPage as { title: string }
        ).title;
        const Probe = () => {
          const t = useTranslations('TaxChangeCalendarPage');
          return React.createElement('h1', null, t('title'));
        };
        const element = await Layout({
          children: React.createElement(Probe),
          params: Promise.resolve({ locale }),
        });
        const html = renderToString(element);
        expect(html).toContain(expected);
        expect(html).not.toContain('__MISSING_');
      },
    );
  },
);

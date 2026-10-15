// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import CalendarTimeline from './components/CalendarTimeline';

/**
 * Shared body and metadata of the tax-change calendar page (task 4.1,
 * change tax-change-calendar).
 *
 * The page exists as TWO physical route folders — the Finnish default
 * path `/veromuutokset` and the English variant `/tax-changes` (served
 * at `/en/tax-changes`; the bare `/tax-changes` under the Finnish
 * negotiation redirects to the Finnish canonical). Both folders import
 * THIS module so the two variants cannot drift; each folder pins its
 * own canonical base path and metadata (design D6: one canonical URL
 * per locale — the pair below is written by hand because the physical
 * folders are deliberately outside the localized-pathnames vocabulary,
 * unlike vocabulary-managed routes).
 *
 * Data stance: the timeline itself is a client island
 * (`CalendarTimeline`) because the calendar endpoints are age-gated —
 * only browser fetches carry the confirmation cookie and trigger the
 * 403 → age-gate recovery event (the /savings and /value precedent).
 * The server shell owns the static editorial copy, the year navigation
 * (URL-state links, no client state), and the cross-links.
 *
 * @module TaxChangeCalendarPage
 */

/** Route-specific wiring one physical folder passes to the shared body. */
export interface CalendarRouteConfig {
  /** The folder's canonical base path in its own locale. */
  readonly basePath: '/veromuutokset' | '/en/tax-changes';
}

/** The normalized locale — routing serves fi and en only (products-page precedent). */
export type CalendarPageLocale = 'fi' | 'en';

/** Normalize the `[locale]` param: anything but `en` renders as Finnish. */
export function calendarLocale(rawLocale: string): CalendarPageLocale {
  return rawLocale === 'en' ? 'en' : 'fi';
}

/** Timeline years the navigation offers around the browsed year. */
export function calendarYearLinks(
  year: number,
  basePath: string,
): { previous: string; next: string } {
  return {
    previous: `${basePath}?year=${year - 1}`,
    next: `${basePath}?year=${year + 1}`,
  };
}

/**
 * The route pair's localized metadata (design D6): the canonical is the
 * ACTIVE locale's URL and `languages` pairs both locales with
 * `x-default` at the negotiating bare (fi) URL. The year query stays
 * out of the canonical — the timeline is one resource per locale, and
 * the year is pagination-like state (the catalog's canonical-clean
 * default rule).
 */
export async function calendarPageMetadata(
  locale: CalendarPageLocale,
): Promise<Metadata> {
  const t = await getTranslations({
    locale,
    namespace: 'TaxChangeCalendarPage',
  });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: {
      canonical: locale === 'en' ? '/en/tax-changes' : '/veromuutokset',
      languages: {
        fi: '/veromuutokset',
        en: '/en/tax-changes',
        'x-default': '/veromuutokset',
      },
    },
  };
}

interface CalendarPageBodyProps {
  /** Normalized locale — selects copy language and the API's language. */
  readonly locale: CalendarPageLocale;
  /** Resolved timeline year (the page normalizes `?year=`). */
  readonly year: number;
  /** The importing folder's canonical base path. */
  readonly basePath: string;
}

/**
 * The shared page body: editorial rhythm copy grounded in the change's
 * verified-facts note, year navigation as plain URL-state anchors (real
 * server-rendered URLs — the localized-paths module's no-JS anchor
 * rationale; the physical folders sit outside the typed vocabulary),
 * the client-fetched timeline, and the cross-links to the what-if
 * simulator and the rate-change blog index.
 */
export async function TaxChangeCalendarPageBody({
  locale,
  year,
  basePath,
}: CalendarPageBodyProps) {
  const t = await getTranslations({
    locale,
    namespace: 'TaxChangeCalendarPage',
  });
  const links = calendarYearLinks(year, basePath);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Title ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">
        {t('subtitle')}
      </p>

      {/* ── Editorial rhythm framing ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm leading-relaxed text-gray-600">
          {t('rhythmIntro')}
        </p>
      </section>

      {/* ── Year navigation — server-rendered URL-state anchors ── */}
      <nav
        aria-label={t('yearNavLabel')}
        data-testid="calendar-year-nav"
        className="mb-8 flex items-center justify-between gap-4"
      >
        <a
          href={links.previous}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('prevYearLink', { year: year - 1 })}
        </a>
        <h2 className="text-lg font-semibold text-gray-900">
          {t('timelineHeading', { year })}
        </h2>
        <a
          href={links.next}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('nextYearLink', { year: year + 1 })}
        </a>
      </nav>

      {/* ── Timeline (client-fetched, age-gated endpoint) ── */}
      <CalendarTimeline year={year} />

      {/* ── Cross-links: what-if simulator + rate-change blog ── */}
      <section
        data-testid="calendar-cross-links"
        className="mt-10 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 className="mb-2 text-base font-semibold text-gray-900">
          {t('crossLinksHeading')}
        </h2>
        <p className="mb-4 text-sm leading-relaxed text-gray-600">
          {t('crossLinksBody')}
        </p>
        <div className="flex flex-wrap gap-4 text-sm font-medium">
          <Link
            href={{ pathname: '/what-if' }}
            className="text-primary-600 underline hover:text-primary-800"
          >
            {t('whatIfLink')}
          </Link>
          <Link
            href={{ pathname: '/blog' }}
            className="text-primary-600 underline hover:text-primary-800"
          >
            {t('blogLink')}
          </Link>
        </div>
      </section>
    </main>
  );
}

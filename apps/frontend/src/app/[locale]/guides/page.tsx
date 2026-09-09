// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import RelatedTools from './related-tools';
import { getServerGuidesIndex } from './guides.server';

interface GuidesIndexPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: GuidesIndexPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'GuidesPage' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

function formatPublished(iso: string | null, locale: string): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Guides index (insight-surfaces task 5.2, spec guides-hub).
 *
 * A server component so crawlers receive the published guide list in
 * the initial HTML. The API serves PUBLISHED GUIDE rows only, per
 * locale — this page adds no status logic of its own. Finnish serves
 * from `/guides`, English from `/en/guides` (localePrefix: 'as-needed').
 *
 * Guides carry no rate-version provenance, so no dataset-version label
 * is rendered even though the shared index-item shape carries the
 * (always null) field. The related-tools block links the two surfaces
 * the guides are most often about — the duty-free allowances reference
 * and the trip calculator (spec: cross-links where topically relevant).
 *
 * Degradation semantics follow the blog/curated-list precedent: a
 * backend failure renders a server-side "unavailable" state instead of
 * an error; zero published guides render the explicit empty state (an
 * answer, not an error). Copy is neutral per the content-policy lint.
 */
export default async function GuidesIndexPage({ params }: GuidesIndexPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'GuidesPage' });
  const outcome = await getServerGuidesIndex(locale);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {outcome.kind === 'unavailable' && (
        <section
          data-testid="guides-unavailable"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h2 className="text-sm font-semibold text-gray-700">
            {t('unavailableTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('unavailableBody')}</p>
        </section>
      )}

      {outcome.kind === 'ok' && outcome.items.length === 0 && (
        <section
          data-testid="guides-empty"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h2 className="text-sm font-semibold text-gray-700">
            {t('emptyTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('emptyBody')}</p>
        </section>
      )}

      {outcome.kind === 'ok' && outcome.items.length > 0 && (
        <ul className="space-y-4" data-testid="guides-index-list">
          {outcome.items.map((guide) => {
            const published = formatPublished(guide.publishedAt, locale);
            return (
              <li key={`${guide.locale}-${guide.slug}`}>
                <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-gray-900">
                    <Link
                      href={`/guides/${guide.slug}`}
                      className="hover:text-primary-700"
                    >
                      {guide.title}
                    </Link>
                  </h2>
                  {published !== null && (
                    <p className="mt-1 text-xs text-gray-400">
                      {t('publishedLabel', { date: published })}
                    </p>
                  )}
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="mt-2 inline-block text-sm font-medium text-primary-600 hover:text-primary-800"
                  >
                    {t('readMore')} →
                  </Link>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <RelatedTools
        labels={{
          title: t('relatedTitle'),
          allowances: t('relatedAllowances'),
          allowancesBody: t('relatedAllowancesBody'),
          trip: t('relatedTrip'),
          tripBody: t('relatedTripBody'),
        }}
      />
    </main>
  );
}

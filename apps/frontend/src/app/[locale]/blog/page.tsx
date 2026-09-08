// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import NewsletterSubscribeForm from '../components/NewsletterSubscribeForm';
import { getServerBlogIndex } from './blog.server';

interface BlogIndexPageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Blog index (trust-and-reach-roadmap task 5.2, spec content-publication).
 *
 * A server component so crawlers receive the published post list in the
 * initial HTML. The API serves PUBLISHED posts only, per locale — this
 * page adds no status logic of its own. Finnish serves from `/blog`,
 * English from `/en/blog` (localePrefix: 'as-needed').
 *
 * Degradation semantics follow the curated-list precedent: a backend
 * failure renders a server-side "unavailable" state instead of an error;
 * zero published posts render the explicit empty state (an answer, not
 * an error). Copy is neutral per the content-policy lint — the blog
 * announces dataset changes and documents method, it never promotes.
 */
export async function generateMetadata({
  params,
}: BlogIndexPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'BlogPage' });

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

export default async function BlogIndexPage({ params }: BlogIndexPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'BlogPage' });
  const outcome = await getServerBlogIndex(locale);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-1 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-8 text-sm text-gray-500">{t('subtitle')}</p>

      {outcome.kind === 'unavailable' && (
        <section
          data-testid="blog-unavailable"
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
          data-testid="blog-empty"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h2 className="text-sm font-semibold text-gray-700">
            {t('emptyTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('emptyBody')}</p>
        </section>
      )}

      {outcome.kind === 'ok' && outcome.items.length > 0 && (
        <ul className="space-y-4" data-testid="blog-index-list">
          {outcome.items.map((post) => {
            const published = formatPublished(post.publishedAt, locale);
            return (
              <li key={`${post.locale}-${post.slug}`}>
                <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-gray-900">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="hover:text-primary-700"
                    >
                      {post.title}
                    </Link>
                  </h2>
                  {published !== null && (
                    <p className="mt-1 text-xs text-gray-400">
                      {t('publishedLabel', { date: published })}
                    </p>
                  )}
                  {post.rateDatasetVersion !== null && (
                    <p className="mt-0.5 text-xs text-gray-400">
                      {t('datasetVersionLabel', {
                        version: post.rateDatasetVersion,
                      })}
                    </p>
                  )}
                  <Link
                    href={`/blog/${post.slug}`}
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

      {/* Newsletter subscribe (task 5.4) — the blog is where rate
          changes are announced, so the opt-in lives beside them. */}
      <div className="mt-8">
        <NewsletterSubscribeForm />
      </div>
    </main>
  );
}

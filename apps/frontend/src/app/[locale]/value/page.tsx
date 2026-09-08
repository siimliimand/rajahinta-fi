// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ValueRanking from './components/ValueRanking';
import {
  VALUE_CATEGORY_KEYS,
  VALUE_DEFAULT_CATEGORY,
  toValueCategoryKey,
} from './categories';

interface ValuePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * €/g value page (trust-and-reach-roadmap task 7.2).
 *
 * The server shell owns everything that does not need the visitor's
 * cookies: title, informational framing, and the category selector —
 * plain links navigating `?category=`, so the selection is URL state and
 * no client state of its own. The table itself loads client-side through
 * the shared API client: the ranking endpoint is age-gated like every
 * other product surface, and only browser fetches carry the confirmation
 * cookie and trigger the 403 → age-gate recovery event.
 *
 * Content stance (unit-price-metrics spec): the listing is informational
 * only. Copy states what the numbers are, never that any product is a
 * good one — the content-policy lint enforces the vocabulary.
 */
export default async function ValuePage({ params, searchParams }: ValuePageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const raw = Array.isArray(query.category) ? query.category[0] : query.category;
  // Unknown or missing category falls back to the default instead of
  // reaching the API and coming back as a 400.
  const category = toValueCategoryKey(raw) ?? VALUE_DEFAULT_CATEGORY;

  const t = await getTranslations('ValuePage');

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Title ── */}
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('title')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{t('subtitle')}</p>

      {/* ── Informational framing ── */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <p className="text-sm leading-relaxed text-gray-600">
          {t('informationalNote')}
        </p>
      </section>

      {/* ── Category selector — server-rendered links, URL-driven state ── */}
      <nav
        aria-label={t('categorySelectorLabel')}
        className="mb-8 flex flex-wrap gap-2"
      >
        {VALUE_CATEGORY_KEYS.map((key) => {
          const active = key === category;
          return (
            <Link
              key={key}
              href={`/value?category=${key}`}
              aria-current={active ? 'page' : undefined}
              className={[
                'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {t(`category.${key}`)}
            </Link>
          );
        })}
      </nav>

      {/* ── Ranking table (client-fetched, age-gated endpoint) ── */}
      <ValueRanking category={category} />
    </main>
  );
}

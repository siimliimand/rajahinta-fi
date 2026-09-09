// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import SavingsListing from './components/SavingsListing';
import {
  SAVINGS_CATEGORY_KEYS,
  SAVINGS_DEFAULT_CATEGORY,
  toSavingsCategoryKey,
} from './categories';

interface SavingsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({
  params,
}: SavingsPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'SavingsPage' });

  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

/**
 * Landed-cost gap page (insight-surfaces task 2.4, spec savings-discovery).
 *
 * The server shell owns everything that does not need the visitor's
 * cookies: title, informational framing (including the ordering rule,
 * stated exactly like the value and ranking pages state theirs), and the
 * category selector — plain links navigating `?category=`, so the
 * selection is URL state and no client state of its own. The table
 * itself loads client-side through the shared API client: the savings
 * endpoint is age-gated like every other product surface, and only
 * browser fetches carry the confirmation cookie and trigger the
 * 403 → age-gate recovery event.
 *
 * Content stance (savings-discovery spec): the listing is informational
 * only. Copy states what the numbers are — a computed difference between
 * an estimated landed total and the Alko reference — never that any
 * product is a worthwhile purchase; the content-policy lint enforces the
 * vocabulary.
 */
export default async function SavingsPage({ params, searchParams }: SavingsPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const query = await searchParams;
  const raw = Array.isArray(query.category) ? query.category[0] : query.category;
  // Unknown or missing category falls back to the default (the value
  // page's normalization precedent).
  const category = toSavingsCategoryKey(raw) ?? SAVINGS_DEFAULT_CATEGORY;

  const t = await getTranslations('SavingsPage');

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
        {SAVINGS_CATEGORY_KEYS.map((key) => {
          const active = key === category;
          return (
            <Link
              key={key}
              href={`/savings?category=${key}`}
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

      {/* ── Savings table (client-fetched, age-gated endpoint) ── */}
      <SavingsListing category={category} />
    </main>
  );
}

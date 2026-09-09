// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getServerGuidePost } from '../guides.server';
import BlogPostBody from '../../blog/blog-post-body';
import RelatedTools from '../related-tools';

interface GuidePostPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Guide page (insight-surfaces task 5.2, spec guides-hub).
 *
 * Serves PUBLISHED GUIDE posts per locale through the kind-agnostic
 * slug endpoint. A DRAFT guide and an unknown slug are the SAME
 * not-found — the API answers one 404 for both and this page must not
 * re-introduce the distinction (no existence leakage for drafts). A
 * backend failure renders the server-side unavailable state (the
 * blog/curated-list precedent): a crawler hit must not error.
 *
 * The body renders through the shared fixed block renderer (paragraphs
 * and bullet lists, all strings escaped) — no markup interpretation of
 * post content. Guides carry no rate-version provenance, so no
 * dataset-version line is rendered. The related-tools block links the
 * duty-free allowances reference and the trip calculator, where the
 * guide content is most often applied.
 */
export async function generateMetadata({
  params,
}: GuidePostPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'GuidesPage' });

  // Unknown slug / draft / backend down → generic metadata; the page
  // body renders not-found or unavailable anyway.
  const outcome = await getServerGuidePost(slug, locale);
  if (outcome.kind !== 'ok') {
    return {
      title: t('metaTitle'),
      description: t('metaDescription'),
    };
  }

  const published = formatPublished(outcome.post.publishedAt, locale);

  return {
    title: t('guideMetaTitle', { title: outcome.post.title }),
    description:
      published !== null
        ? t('guideMetaDescription', { date: published })
        : t('metaDescription'),
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

export default async function GuidePostPage({ params }: GuidePostPageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'GuidesPage' });
  const outcome = await getServerGuidePost(slug, locale);

  // Unknown slug and DRAFT are the same 404 — not-found without any
  // existence signal beyond "no published guide here".
  if (outcome.kind === 'not-found') {
    notFound();
  }

  if (outcome.kind === 'unavailable') {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <section
          data-testid="guides-unavailable"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h1 className="text-sm font-semibold text-gray-700">
            {t('unavailableTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t('unavailableBody')}</p>
          <Link
            href="/guides"
            className="mt-3 inline-block text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            {t('backToGuides')}
          </Link>
        </section>
      </main>
    );
  }

  const { post } = outcome;
  const published = formatPublished(post.publishedAt, locale);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <article>
        <h1 className="mb-2 text-2xl font-bold text-primary-700">
          {post.title}
        </h1>
        {published !== null && (
          <p className="mb-6 text-xs text-gray-400">
            {t('publishedLabel', { date: published })}
          </p>
        )}

        <BlogPostBody bodyMarkdown={post.bodyMarkdown} />
      </article>

      <RelatedTools
        labels={{
          title: t('relatedTitle'),
          allowances: t('relatedAllowances'),
          allowancesBody: t('relatedAllowancesBody'),
          trip: t('relatedTrip'),
          tripBody: t('relatedTripBody'),
        }}
      />

      <nav className="mt-10 border-t border-gray-200 pt-6">
        <Link
          href="/guides"
          className="text-sm font-medium text-primary-600 hover:text-primary-800"
        >
          {t('backToGuides')}
        </Link>
      </nav>
    </main>
  );
}

// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import NewsletterSubscribeForm from '../../components/NewsletterSubscribeForm';
import { getServerBlogPost } from '../blog.server';
import BlogPostBody from '../blog-post-body';

interface BlogPostPageProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Blog post page (trust-and-reach-roadmap task 5.2, spec
 * content-publication).
 *
 * Serves PUBLISHED posts per locale. A DRAFT post and an unknown slug
 * are the SAME not-found — the API answers one 404 for both and this
 * page must not re-introduce the distinction (no existence leakage for
 * drafts). A backend failure renders the server-side unavailable state
 * (the curated-list precedent): a crawler hit must not error.
 *
 * The body renders through the fixed block renderer (paragraphs and
 * bullet lists, all strings escaped) — no markup interpretation of post
 * content. Copy around the post stays neutral per the content policy.
 */
export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'BlogPage' });

  // Unknown slug / draft / backend down → generic metadata; the page
  // body renders not-found or unavailable anyway.
  const outcome = await getServerBlogPost(slug, locale);
  if (outcome.kind !== 'ok') {
    return {
      title: t('metaTitle'),
      description: t('metaDescription'),
    };
  }

  const published = formatPublished(outcome.post.publishedAt, locale);

  return {
    title: t('postMetaTitle', { title: outcome.post.title }),
    description:
      published !== null
        ? t('postMetaDescription', { date: published })
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

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'BlogPage' });
  const outcome = await getServerBlogPost(slug, locale);

  // Unknown slug and DRAFT are the same 404 — not-found without any
  // existence signal beyond "no published post here".
  if (outcome.kind === 'not-found') {
    notFound();
  }

  if (outcome.kind === 'unavailable') {
    return (
      <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <section
          data-testid="blog-unavailable"
          className="rounded-lg border border-gray-200 bg-gray-50 p-6"
        >
          <h1 className="text-sm font-semibold text-gray-700">
            {t('unavailableTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t('unavailableBody')}</p>
          <Link
            href="/blog"
            className="mt-3 inline-block text-sm font-medium text-primary-600 hover:text-primary-800"
          >
            {t('backToBlog')}
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
        <div className="mb-6 text-xs text-gray-400">
          {published !== null && (
            <p>{t('publishedLabel', { date: published })}</p>
          )}
          {post.rateDatasetVersion !== null && (
            <p className="mt-0.5">
              {t('datasetVersionLabel', { version: post.rateDatasetVersion })}
            </p>
          )}
        </div>

        <BlogPostBody bodyMarkdown={post.bodyMarkdown} />
      </article>

      <nav className="mt-10 border-t border-gray-200 pt-6">
        <Link
          href="/blog"
          className="text-sm font-medium text-primary-600 hover:text-primary-800"
        >
          {t('backToBlog')}
        </Link>
      </nav>

      {/* Newsletter subscribe (task 5.4) — beside the announcement
          content, with consent copy separate from price alerts. */}
      <div className="mt-8">
        <NewsletterSubscribeForm />
      </div>
    </main>
  );
}

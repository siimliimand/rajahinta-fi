/**
 * Article JSON-LD for the blog and guide detail pages (change
 * seo-aeo-agent-surfaces, task 1.2).
 *
 * The builder sits beside the blog server module the way the shared
 * body renderer does — both detail trees consume it, and neither
 * server module grows a second responsibility. The house shape is the
 * curated-list builder: typed schema interfaces, a localized absolute
 * URL through the routing vocabulary (design D6), and every value
 * traceable to the stored post row the page already fetched.
 *
 * Emitted fields, and nothing else:
 *   - `headline`        → the stored title
 *   - `datePublished`   → the stored `publishedAt`, verbatim, ONLY when
 *     present and parseable (a post without a date emits no date)
 *   - `author`          → the site's Organization entity
 *   - `inLanguage`      → the serving locale (fi/en)
 *   - `mainEntityOfPage`→ the canonical URL of the serving page
 *
 * `dateModified` has no stored source — the BlogPost contract carries
 * `publishedAt` alone — so it is never emitted. No field is fabricated
 * to fill the graph.
 *
 * @module ArticleJsonLd
 */

import { SITE_URL } from '@/lib/api';
import { localizedPath } from '@/lib/i18n/localized-paths';
import type { BlogPost } from '@/lib/types';

/** The serving locales — the routing config serves fi and en only. */
type ServingLocale = 'fi' | 'en';

/** schema.org Organization — the site's publisher entity. */
interface JsonLdOrganization {
  readonly '@type': 'Organization';
  readonly name: 'Rajahinta.fi';
  readonly url: string;
}

/** schema.org WebPage reference — the canonical page, addressed by @id. */
interface JsonLdWebPageRef {
  readonly '@type': 'WebPage';
  readonly '@id': string;
}

/**
 * schema.org Article (guides) / BlogPosting (blog posts) — the
 * structured-data graph the detail pages embed as one ld+json script.
 */
export interface ArticleJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'Article' | 'BlogPosting';
  readonly headline: string;
  /** Present only when the stored post carries a parseable date. */
  readonly datePublished?: string;
  readonly inLanguage: ServingLocale;
  readonly author: JsonLdOrganization;
  readonly mainEntityOfPage: JsonLdWebPageRef;
}

/**
 * Locale-prefixed absolute URL for a blog post — the same URL the
 * canonical/hreflang metadata emits (FI /blogi/[slug], EN /en/blog/[slug]).
 */
export function blogPostPageUrl(slug: string, locale: string): string {
  return `${SITE_URL}${localizedPath(locale === 'en' ? 'en' : 'fi', {
    pathname: '/blog/[slug]',
    params: { slug },
  })}`;
}

/**
 * Locale-prefixed absolute URL for a guide — FI /oppaat/[slug],
 * EN /en/guides/[slug] (the same vocabulary the sitemap emits).
 */
export function guidePageUrl(slug: string, locale: string): string {
  return `${SITE_URL}${localizedPath(locale === 'en' ? 'en' : 'fi', {
    pathname: '/guides/[slug]',
    params: { slug },
  })}`;
}

/** The BlogPosting graph for one fetched blog post. */
export function buildBlogPostJsonLd(
  post: BlogPost,
  locale: string,
): ArticleJsonLd {
  return buildArticleJsonLd(
    post,
    locale,
    'BlogPosting',
    blogPostPageUrl(post.slug, locale),
  );
}

/** The Article graph for one fetched guide post. */
export function buildGuideJsonLd(post: BlogPost, locale: string): ArticleJsonLd {
  return buildArticleJsonLd(
    post,
    locale,
    'Article',
    guidePageUrl(post.slug, locale),
  );
}

function buildArticleJsonLd(
  post: BlogPost,
  locale: string,
  type: 'Article' | 'BlogPosting',
  pageUrl: string,
): ArticleJsonLd {
  const datePublished = storedPublishedAt(post.publishedAt);
  return {
    '@context': 'https://schema.org',
    '@type': type,
    headline: post.title,
    ...(datePublished !== undefined ? { datePublished } : {}),
    inLanguage: locale === 'en' ? 'en' : 'fi',
    author: { '@type': 'Organization', name: 'Rajahinta.fi', url: SITE_URL },
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
  };
}

/**
 * The stored publication date verbatim, or nothing: null and
 * unparseable values contribute no property (absent, never a
 * placeholder — the same honesty the page's displayed date applies).
 */
function storedPublishedAt(value: string | null): string | undefined {
  if (value === null) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

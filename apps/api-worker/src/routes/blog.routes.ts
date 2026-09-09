/**
 * Public blog + guides routes (task 5.1, changes trust-and-reach-roadmap
 * and insight-surfaces; spec content-publication) — PUBLISHED posts only,
 * never drafts, and kinds never mix: the blog index lists RATE_CHANGE
 * only, the guides index GUIDE only.
 *
 *   GET /api/v1/blog/posts           rate-change index for one locale (?locale=fi|en)
 *   GET /api/v1/blog/posts/:slug     one post's body for one locale (either kind)
 *   GET /api/v1/guides               guides index for one locale (?locale=fi|en)
 *
 * Drafts are invisible publicly: a DRAFT or unknown slug answers the
 * SAME 404 — no existence leakage (spec scenario "Drafts invisible
 * publicly" + the share-link 404 parity). The list endpoints return
 * PUBLISHED rows only, via the repository's (locale, kind, status) read.
 * No guard: all reads are public (the ops publish action rides the
 * /ops/console prefix instead).
 *
 * @module BlogRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { D1BlogPostRepository } from '../../../../packages/data-platform/src/repositories/d1/blog-post.repository';
import type { BlogPostRecord } from '../../../../packages/data-platform/src/abstracts';

/** The locale set the blog serves at launch (schema docblock parity). */
const BLOG_LOCALES: ReadonlySet<string> = new Set(['fi', 'en']);

/** Resolve + validate the locale query parameter (default fi). */
function resolveLocale(c: Context<AppEnv>): string {
  const locale = c.req.query('locale') ?? 'fi';
  if (!BLOG_LOCALES.has(locale)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: `locale must be one of: ${[...BLOG_LOCALES].join(', ')}`,
      error: 'ValidationError',
    });
  }
  return locale;
}

/** Index item — no body (the slug page fetches it). */
function toIndexItem(post: BlogPostRecord): Record<string, unknown> {
  return {
    slug: post.slug,
    locale: post.locale,
    title: post.title,
    rateDatasetVersion: post.rateDatasetVersion,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}

/** Full post — body included; the structural disclaimer is content. */
function toFullPost(post: BlogPostRecord): Record<string, unknown> {
  return {
    ...toIndexItem(post),
    bodyMarkdown: post.bodyMarkdown,
  };
}

async function listPosts(c: Context<AppEnv>): Promise<Response> {
  const locale = resolveLocale(c);
  const posts = await new D1BlogPostRepository(c.env.DB).listByLocaleAndKind(
    locale,
    'RATE_CHANGE',
    'PUBLISHED',
  );
  return c.json({ items: posts.map(toIndexItem), total: posts.length });
}

async function listGuides(c: Context<AppEnv>): Promise<Response> {
  const locale = resolveLocale(c);
  const guides = await new D1BlogPostRepository(c.env.DB).listByLocaleAndKind(
    locale,
    'GUIDE',
    'PUBLISHED',
  );
  return c.json({ items: guides.map(toIndexItem), total: guides.length });
}

async function getPost(c: Context<AppEnv>): Promise<Response> {
  const slug = c.req.param('slug') ?? '';
  const locale = resolveLocale(c);
  const post = await new D1BlogPostRepository(c.env.DB).findBySlugAndLocale(
    slug,
    locale,
  );
  // DRAFT and unknown are the same 404 — drafts do not exist publicly.
  if (post === null || post.status !== 'PUBLISHED') {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: 'Blog post not found',
      error: 'BlogPostNotFound',
    });
  }
  return c.json(toFullPost(post));
}

/** Register the public blog/guide handlers (no guards — public reads). */
export function registerBlogRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get('/api/v1/blog/posts', listPosts);
  app.get('/api/v1/blog/posts/:slug', getPost);
  app.get('/api/v1/guides', listGuides);
  return app;
}

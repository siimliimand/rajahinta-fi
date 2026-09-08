/**
 * Blog server fetches (trust-and-reach-roadmap task 5.2; API contract
 * committed in task 5.1, apps/api-worker blog.routes.ts).
 *
 * The response shapes mirror the route's serialization EXACTLY — index
 * items (slug, locale, title, rateDatasetVersion, publishedAt) and full
 * posts (plus bodyMarkdown), PUBLISHED only.
 *
 * Outcome semantics (the distinction the pages render on):
 *   - unknown slug or draft  → `{ kind: 'not-found' }`  (the API answers
 *     the SAME 404 for both — drafts do not exist publicly, and this
 *     module must not re-introduce the distinction)
 *   - fetch failure          → `{ kind: 'unavailable' }` (backend down,
 *     unexpected shape — the public page degrades, never errors)
 *   - found                  → `{ kind: 'ok', post }` / `{ kind: 'ok', items }`
 *
 * Fetch pattern: server-side with the sitemap's 900 s revalidation
 * cadence (editorial content, not per-second price data). The blog
 * endpoints sit outside the age gate's path scope (unguarded public
 * reads), so no age-confirmation header is sent.
 *
 * @module BlogServer
 */

import { ApiFetchError, request } from '@/lib/api';
import type {
  BlogPost,
  BlogPostIndexItem,
  BlogPostListResponse,
} from '@/lib/types';

/** What the index page renders on. */
export type BlogIndexOutcome =
  | { readonly kind: 'ok'; readonly items: readonly BlogPostIndexItem[] }
  | { readonly kind: 'unavailable' };

/** What the slug page renders on. */
export type BlogPostOutcome =
  | { readonly kind: 'ok'; readonly post: BlogPost }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/** Structural guard on an index item — an unexpected shape degrades. */
function isIndexItem(value: unknown): value is BlogPostIndexItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.slug === 'string' &&
    typeof item.locale === 'string' &&
    typeof item.title === 'string' &&
    (item.rateDatasetVersion === null ||
      typeof item.rateDatasetVersion === 'string') &&
    (item.publishedAt === null || typeof item.publishedAt === 'string')
  );
}

/** Structural guard on a full post. */
function isFullPost(value: unknown): value is BlogPost {
  if (!isIndexItem(value)) return false;
  return typeof (value as { bodyMarkdown?: unknown }).bodyMarkdown === 'string';
}

/**
 * PUBLISHED posts for one locale, newest first (the API returns
 * publication-order rows; ordering here keeps the page deterministic
 * even if the repository order ever changes). Any failure degrades to
 * `unavailable`, mirroring the curated-list degradation contract.
 */
export async function getServerBlogIndex(
  locale: string,
): Promise<BlogIndexOutcome> {
  try {
    const res = await request<BlogPostListResponse>(
      `/api/v1/blog/posts?locale=${encodeURIComponent(locale)}`,
      {
        headers: { accept: 'application/json' },
        next: { revalidate: 900 },
      },
    );
    if (!Array.isArray(res?.items)) {
      return { kind: 'unavailable' };
    }
    const items = res.items.filter(isIndexItem);
    items.sort((a, b) => publishedOrder(a.publishedAt, b.publishedAt));
    return { kind: 'ok', items };
  } catch {
    return { kind: 'unavailable' };
  }
}

/**
 * One PUBLISHED post by slug for one locale. A 404 covers both the
 * unknown slug and the DRAFT post — the API's contract — so this
 * module carries no status logic of its own.
 */
export async function getServerBlogPost(
  slug: string,
  locale: string,
): Promise<BlogPostOutcome> {
  try {
    const post = await request<BlogPost>(
      `/api/v1/blog/posts/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`,
      {
        headers: { accept: 'application/json' },
        next: { revalidate: 900 },
      },
    );
    if (!isFullPost(post)) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', post };
  } catch (err: unknown) {
    if (err instanceof ApiFetchError && err.status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'unavailable' };
  }
}

/** Newest first; posts without a date sort last, deterministically. */
function publishedOrder(a: string | null, b: string | null): number {
  const ta = a === null ? 0 : Date.parse(a);
  const tb = b === null ? 0 : Date.parse(b);
  const na = Number.isNaN(ta) ? 0 : ta;
  const nb = Number.isNaN(tb) ? 0 : tb;
  return nb - na;
}

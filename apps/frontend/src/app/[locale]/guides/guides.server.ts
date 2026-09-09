/**
 * Guides server fetches (insight-surfaces task 5.2, spec guides-hub; API
 * contract committed in task 5.1, api-worker blog.routes.ts).
 *
 * The response shapes mirror the routes' serialization EXACTLY — the
 * guides index (GET /api/v1/guides) lists GUIDE-kind PUBLISHED rows for
 * one locale, and the slug read reuses the kind-agnostic
 * GET /api/v1/blog/posts/:slug (PUBLISHED only, both kinds), so the
 * shared BlogPost types from lib/types describe both. Guides carry no
 * rate-version provenance — the index item's rateDatasetVersion is null
 * by contract and the pages never render a provenance block.
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
 * cadence (editorial content, not per-second price data). The guide
 * endpoints sit outside the age gate (unguarded public reads), so no
 * age-confirmation header is sent.
 *
 * @module GuidesServer
 */

import { ApiFetchError, request } from '@/lib/api';
import type {
  BlogPost,
  BlogPostIndexItem,
  BlogPostListResponse,
} from '@/lib/types';

/** What the index page renders on. */
export type GuidesIndexOutcome =
  | { readonly kind: 'ok'; readonly items: readonly BlogPostIndexItem[] }
  | { readonly kind: 'unavailable' };

/** What the slug page renders on. */
export type GuidePostOutcome =
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
 * PUBLISHED guides for one locale, newest first (the API returns
 * publication-order rows; ordering here keeps the page deterministic
 * even if the repository order ever changes). Any failure degrades to
 * `unavailable`, mirroring the blog/curated-list degradation contract.
 */
export async function getServerGuidesIndex(
  locale: string,
): Promise<GuidesIndexOutcome> {
  try {
    const res = await request<BlogPostListResponse>(
      `/api/v1/guides?locale=${encodeURIComponent(locale)}`,
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
 * One PUBLISHED post by slug for one locale — the kind-agnostic slug
 * endpoint serves GUIDE rows too. A 404 covers both the unknown slug
 * and the DRAFT post — the API's contract — so this module carries no
 * status logic of its own.
 */
export async function getServerGuidePost(
  slug: string,
  locale: string,
): Promise<GuidePostOutcome> {
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

/**
 * Curated-list server fetch + JSON-LD (task 7.3, change
 * product-roadmap-phases-1-4; API contract committed in task 7.2,
 * api-worker curated-lists.routes.ts).
 *
 * The response mirrors the route's serialization EXACTLY — slug, title,
 * curation criteria, and the published-entry projection (id, target,
 * rationale, evidence links) and nothing else. The frontend types are
 * declared here rather than in the shared lib/types because the touch
 * set is the lists scope; the route remains the single source of truth.
 *
 * Outcome semantics (the distinction the page renders on):
 *   - unknown slug          → `{ kind: 'not-found' }`   (API 404)
 *   - flag off / fetch fail → `{ kind: 'unavailable' }` (API 403, 5xx,
 *     unreachable backend — degrade, never error the response)
 *   - known slug            → `{ kind: 'ok', list }` with `entries: []`
 *     when nothing is published yet (an answer, not an error — the page
 *     renders criteria + the empty state)
 *
 * Fetch pattern: server-side with the sitemap's 900 s revalidation
 * cadence (editorial content, not per-second price data). The lists
 * endpoints sit outside the age gate's path scope, so no
 * age-confirmation header is sent.
 *
 * @module CuratedListsServer
 */

import { ApiFetchError, request, SITE_URL } from '@/lib/api';
import { routing } from '@/i18n/routing';

/** One validated evidence link — {label, url} as serialized by the API. */
export interface EvidenceLink {
  readonly label: string;
  readonly url: string;
}

/** One published entry — the page-facing evidence projection. */
export interface CuratedListEntry {
  readonly id: number;
  /** The Alko product reference — null exactly when externalRef is set. */
  readonly productId: number | null;
  /** The external reference — null exactly when productId is set. */
  readonly externalRef: string | null;
  /** The mandatory editorial justification. */
  readonly rationale: string;
  /** Validated evidence links (non-empty array per repository invariant). */
  readonly evidenceLinks: readonly EvidenceLink[];
}

/** GET /api/v1/lists/:slug response. */
export interface CuratedList {
  readonly slug: string;
  readonly title: string;
  readonly criteria: readonly string[];
  readonly entries: readonly CuratedListEntry[];
}

/** What the page renders on — the three API outcomes above. */
export type CuratedListOutcome =
  | { readonly kind: 'ok'; readonly list: CuratedList }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

/**
 * Fetch a curated list by slug on the server, classified into the page's
 * three render outcomes. Any failure the page cannot act on (flag-off
 * 403, unexpected shape, 5xx, unreachable backend) degrades to
 * `unavailable`, mirroring the sitemap's degradation contract.
 */
export async function getServerCuratedList(
  slug: string,
): Promise<CuratedListOutcome> {
  try {
    const list = await request<CuratedList>(`/api/v1/lists/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: 900 },
    });
    if (
      typeof list?.slug !== 'string' ||
      typeof list?.title !== 'string' ||
      !Array.isArray(list?.criteria) ||
      !Array.isArray(list?.entries)
    ) {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', list };
  } catch (err: unknown) {
    if (err instanceof ApiFetchError && err.status === 404) {
      return { kind: 'not-found' };
    }
    return { kind: 'unavailable' };
  }
}

// ---------------------------------------------------------------------------
// Structured data (JSON-LD)
// ---------------------------------------------------------------------------

/** schema.org ListItem — position plus the item URL when one exists. */
interface JsonLdListItem {
  readonly '@type': 'ListItem';
  readonly position: number;
  /** The local product page — absent for externalRef-only entries. */
  readonly url?: string;
}

/** schema.org ItemList — the list's published entries in served order. */
interface JsonLdItemList {
  readonly '@type': 'ItemList';
  readonly itemListElement: readonly JsonLdListItem[];
}

/**
 * CollectionPage schema with the ItemList as its main entity — the
 * structured-data type for an editorial page whose content IS a list of
 * items. ListItems carry only factual URLs: a local product page when the
 * entry has a productId, nothing fabricated for externalRef-only entries.
 */
export interface CuratedListJsonLd {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'CollectionPage';
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly mainEntity: JsonLdItemList;
}

/**
 * Locale-prefixed absolute URL for a list page — the sitemap's prefix
 * rule (default locale serves unprefixed, others under /{locale}).
 */
export function curatedListPageUrl(slug: string, locale: string): string {
  const prefix =
    locale === routing.defaultLocale ? '' : `/${locale}`;
  return `${SITE_URL}${prefix}/lists/${slug}`;
}

/**
 * Build the CollectionPage/ItemList JSON-LD for a fetched list.
 *
 * `description` is the page's localized meta description, interpolated by
 * the caller — the schema mirrors what the meta tags state rather than
 * inventing a second description string.
 */
export function buildCuratedListJsonLd(
  list: CuratedList,
  locale: string,
  description: string,
): CuratedListJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: list.title,
    url: curatedListPageUrl(list.slug, locale),
    description,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: list.entries.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        ...(entry.productId !== null
          ? {
              url: `${SITE_URL}${locale === routing.defaultLocale ? '' : `/${locale}`}/products/${entry.productId}`,
            }
          : {}),
      })),
    },
  };
}

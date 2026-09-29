// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { request, SERVER_AGE_CONFIRMATION_TOKEN } from '@/lib/api';
import { formatAbv, formatVolume } from '@/lib/format/product-attributes';
import type { ProductSearchItem, ProductSearchResult } from '@/lib/types';
import { Badge, Card, EmptyState, ErrorState } from '@/components/ui';
import CategoryAlertAction from './components/CategoryAlertAction';
import {
  CANONICAL_CATEGORIES,
  CATEGORY_LABELS,
  categoryLabel,
  type CanonicalCategory,
} from './category-labels';

/**
 * Catalog page (task 3.1, change product-catalog).
 *
 * A server component over the GET /api/v1/products browse contract
 * (committed in task 2.1): category, page, sort, and the keyword search
 * live in the URL query string and every control is a plain link or a
 * no-JS GET form (design D5), so each (category, q, sort, page) state
 * renders and crawls without client-side JavaScript. The 900 s
 * revalidate matches the product-page server fetches (product-dupes.ts,
 * price-context.ts); offer data refreshes hourly at most.
 *
 * Category validation is forgiving here (design D2): the page faces
 * humans and mistyped links, so an unknown ?category= value is treated
 * as absent and the unfiltered view renders. The API stays strict
 * (400 on unknown values), so the page resolves the parameter BEFORE
 * fetching and never sends a value the contract rejects. The ?sort=
 * value gets the same forgiving treatment (task 1.3): unknown values
 * fall back to the default order instead of a 400.
 *
 * Copy note (task 3.2): all catalog copy lives in the message catalogs
 * under the ProductsPage namespace; the category labels are the shared
 * ./category-labels vocabulary (the same labels the accuracy breakdown's
 * category cells render), and the ABV line reuses the existing
 * Common.abvValue key. Discoverability
 * (design D6): generateMetadata renders per-category FI/EN titles and
 * descriptions, and every (category, page) state emits a canonical URL
 * so parameter permutations do not fragment the index.
 *
 * @module CatalogPage
 */

/** Canonical product categories and their labels live in the shared
 *  ./category-labels module (task 5.1) — the accuracy breakdown's
 *  category cells render the same vocabulary. */

/**
 * Sort orders the listing API contract accepts (task 1.3) — mirrors
 * CATALOG_SORT_ORDERS in the worker route, which is the enforcing
 * authority (unknown values are a 400 there). The page resolves the
 * parameter forgivingly before fetching, mirroring the category
 * treatment above.
 */
const CATALOG_SORT_ORDERS = [
  'ALPHABETICAL',
  'LOWEST_PRICE',
  'ALCOHOL_PERCENTAGE',
] as const;

type CatalogSortOrder = (typeof CATALOG_SORT_ORDERS)[number];

const DEFAULT_SORT: CatalogSortOrder = 'ALPHABETICAL';

/**
 * Search-query cap, mirroring the embed widget's MAX_QUERY_LENGTH —
 * absurdly long ?q= values never reach the API.
 */
const CATALOG_MAX_QUERY_LENGTH = 100;

/** Locales the [locale] segment serves (fi is the default, en prefixed). */
type CatalogLocale = 'fi' | 'en';

/** Fixed catalog page size (design D5) and revalidate window. */
const CATALOG_PAGE_SIZE = 24;
const CATALOG_REVALIDATE_SECONDS = 900;

/**
 * Sort-order option labels — message-catalog keys (design: labels are
 * catalog keys, never hardcoded strings).
 */
const SORT_LABEL_KEYS: Record<CatalogSortOrder, string> = {
  ALPHABETICAL: 'sortOptionAlphabetical',
  LOWEST_PRICE: 'sortOptionLowestPrice',
  ALCOHOL_PERCENTAGE: 'sortOptionAlcoholPercentage',
};

/**
 * Forgiving category resolution (design D2): absent, blank, and unknown
 * values all render the unfiltered view. The API's strict 400 never
 * happens because only resolved canonical values are ever sent.
 */
function resolveCategoryParam(
  raw: string | string[] | undefined,
): CanonicalCategory | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return undefined;
  return (CANONICAL_CATEGORIES as readonly string[]).includes(trimmed)
    ? (trimmed as CanonicalCategory)
    : undefined;
}

/** 1-based page number; anything malformed falls back to the first page. */
function resolvePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Forgiving sort resolution (task 1.3): absent, blank, and unknown
 * values all render the default alphabetical order — the API's strict
 * 400 never happens because only resolved canonical values are sent.
 */
function resolveSortParam(
  raw: string | string[] | undefined,
): CatalogSortOrder {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0) return DEFAULT_SORT;
  return (CATALOG_SORT_ORDERS as readonly string[]).includes(trimmed)
    ? (trimmed as CatalogSortOrder)
    : DEFAULT_SORT;
}

/**
 * Forgiving search resolution (task 2.1): blank means "no search" and a
 * longer input is capped before it reaches the API — the URL never
 * carries a whitespace-only or oversized q.
 */
function resolveQParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? '').trim().slice(0, CATALOG_MAX_QUERY_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Catalog URL for one (category, q, sort, page) state — the single
 * builder every filter, pagination, sort, and search link uses, so all
 * four state dimensions always round-trip together (spec product-search:
 * the search value lives in the URL query state). The default sort is
 * omitted from links so URLs stay canonical-clean, and category and
 * search links pass `page: undefined` to reset to page 1 (both change
 * the result set, invalidating the old pagination).
 */
function catalogHref(
  category: CanonicalCategory | undefined,
  page: number | undefined,
  sort: CatalogSortOrder,
  q: string | undefined,
): string {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (q !== undefined) params.set('q', q);
  if (sort !== DEFAULT_SORT) params.set('sort', sort);
  if (page !== undefined && page > 1) params.set('page', String(page));
  const search = params.toString();
  return `/products${search === '' ? '' : `?${search}`}`;
}

/** Listing-API path for one (category, q, sort, page) state — the query
 *  carries the canonical category only when one was resolved, the
 *  keyword only when present (the API applies both together), and the
 *  sort only when it is not the default (blank means default at the API
 *  too). */
function catalogQueryPath(
  category: CanonicalCategory | undefined,
  page: number,
  sort: CatalogSortOrder,
  q: string | undefined,
): string {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (q !== undefined) params.set('q', q);
  if (sort !== DEFAULT_SORT) params.set('sort', sort);
  params.set('page', String(page));
  params.set('limit', String(CATALOG_PAGE_SIZE));
  return `/api/v1/products?${params.toString()}`;
}

/**
 * Server fetch of the listing API, or null when unavailable (backend
 * unreachable, 5xx) so the page degrades to an explained state instead
 * of erroring — the same degrade pattern as the product-page server
 * fetches.
 */
async function getServerCatalogPage(
  category: CanonicalCategory | undefined,
  page: number,
  sort: CatalogSortOrder,
  q: string | undefined,
): Promise<ProductSearchResult | null> {
  try {
    return await request<ProductSearchResult>(
      catalogQueryPath(category, page, sort, q),
      {
        headers: { 'x-age-confirmed': SERVER_AGE_CONFIRMATION_TOKEN },
        next: { revalidate: CATALOG_REVALIDATE_SECONDS },
      },
    );
  } catch {
    return null;
  }
}

/** Locale-appropriate euro formatting for the observed lowest price. */
function formatEuro(cents: number, locale: CatalogLocale): string {
  try {
    return new Intl.NumberFormat(locale === 'fi' ? 'fi-FI' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} €`;
  }
}

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/* Filter, pagination, sort, and search controls carry the ≥44 px touch
 * floor (task 5.4, web-application mobile-first interaction standards). */
const FILTER_LINK_CLASSES = [
  'touch-target inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
  'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
] as const;

const FILTER_ACTIVE_CLASSES =
  'touch-target inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors border-primary-600 bg-primary-600 text-white';

const PAGE_LINK_CLASSES =
  'touch-target inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

const PAGE_SPAN_CLASSES =
  'touch-target inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-400';

const PAGE_CURRENT_CLASSES =
  'touch-target inline-flex items-center rounded-md border border-primary-600 bg-primary-600 px-3 py-1.5 text-sm font-medium text-white';

/**
 * Canonical path for one (category, page) state (design D6): the clean
 * URL of the state, so parameter permutations do not fragment the index.
 * Page 1 canonicalizes without the page parameter, and nothing else from
 * the query string survives. The layout's metadataBase resolves the path
 * to the absolute URL; English lives under /en (localePrefix 'as-needed').
 */
function catalogCanonicalPath(
  locale: CatalogLocale,
  category: CanonicalCategory | undefined,
  page: number,
): string {
  const prefix = locale === 'en' ? '/en' : '';
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return `${prefix}/products${search === '' ? '' : `?${search}`}`;
}

/**
 * Per-state metadata (design D6): the unfiltered view and each category
 * view carry their own localized title and description, plus the
 * canonical URL for the resolved state. Unknown category values never
 * reach this function — the same forgiving resolution as the page body
 * maps them to the unfiltered view before the fetch.
 */
export async function generateMetadata({
  params,
  searchParams,
}: ProductsPageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  const locale: CatalogLocale = rawLocale === 'en' ? 'en' : 'fi';

  const query = await searchParams;
  const category = resolveCategoryParam(query.category);
  const page = resolvePageParam(query.page);

  const t = await getTranslations({ locale, namespace: 'ProductsPage' });
  const categoryLabel =
    category !== undefined ? CATEGORY_LABELS[category][locale] : null;

  return {
    title:
      categoryLabel !== null
        ? t('metaCategoryTitle', { category: categoryLabel })
        : t('metaTitle'),
    description:
      categoryLabel !== null
        ? t('metaCategoryDescription', { category: categoryLabel })
        : t('metaDescription'),
    alternates: {
      canonical: catalogCanonicalPath(locale, category, page),
    },
  };
}

export default async function ProductsPage({
  params,
  searchParams,
}: ProductsPageProps) {
  const { locale: rawLocale } = await params;
  const locale: CatalogLocale = rawLocale === 'en' ? 'en' : 'fi';
  setRequestLocale(locale);

  const query = await searchParams;
  const category = resolveCategoryParam(query.category);
  const page = resolvePageParam(query.page);
  const sort = resolveSortParam(query.sort);
  const q = resolveQParam(query.q);

  const t = await getTranslations({ locale, namespace: 'ProductsPage' });

  const result = await getServerCatalogPage(category, page, sort, q);

  if (result === null) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-2xl font-bold text-primary-700">
          {t('heading')}
        </h1>
        {/* ── Human server-error state (task 3.3): no raw status code —
            a plain explanation plus a same-state retry link (the page is
            a server component, so the retry is a plain link to the very
            URL that failed). ── */}
        <ErrorState title={t('unavailableTitle')} description={t('unavailableBody')}>
          <Link
            href={catalogHref(category, page, sort, q)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('retryLabel')}
          </Link>
        </ErrorState>
      </main>
    );
  }

  const items = result.items;
  const totalPages = result.totalPages;

  const pageHref = (target: number): string =>
    catalogHref(category, target, sort, q);

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{t('heading')}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{t('intro')}</p>

      {/* ── Keyword search (task 2.1) — a no-JS GET form so the query is
          URL state like category, sort, and page (spec product-search).
          Category and sort travel in hidden fields; the combined
          category+q filtering is the API contract. A search resets to
          page 1 (no page field in the form). ── */}
      <form
        method="get"
        action="/products"
        role="search"
        data-testid="catalog-search"
        className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-2"
      >
        {category !== undefined ? (
          <input type="hidden" name="category" value={category} />
        ) : null}
        {sort !== DEFAULT_SORT ? (
          <input type="hidden" name="sort" value={sort} />
        ) : null}
        <label
          htmlFor="catalog-search-input"
          className="text-sm font-medium text-gray-700"
        >
          {t('searchLabel')}
        </label>
        <input
          id="catalog-search-input"
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder={t('searchPlaceholder')}
          maxLength={CATALOG_MAX_QUERY_LENGTH}
          className="touch-target w-64 max-w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400"
        />
        <button type="submit" className={FILTER_LINK_CLASSES.join(' ')}>
          {t('searchSubmit')}
        </button>
        {q !== undefined ? (
          <Link
            href={catalogHref(category, undefined, sort, undefined)}
            className="text-sm text-primary-700 hover:underline"
          >
            {t('searchClear')}
          </Link>
        ) : null}
      </form>

      {/* ── Category filter — URL state as plain links; every category
          link targets page 1 of that category and preserves the active
          search and sort (tasks 1.3, 2.1) ── */}
      <nav
        aria-label={t('filterNavLabel')}
        data-testid="catalog-filter-row"
        className="mb-4 flex flex-wrap gap-2"
      >
        <Link
          href={catalogHref(undefined, undefined, sort, q)}
          aria-current={category === undefined ? 'page' : undefined}
          className={
            category === undefined ? FILTER_ACTIVE_CLASSES : FILTER_LINK_CLASSES.join(' ')
          }
        >
          {t('allProducts')}
        </Link>
        {CANONICAL_CATEGORIES.map((key) => {
          const active = category === key;
          return (
            <Link
              key={key}
              href={catalogHref(key, undefined, sort, q)}
              aria-current={active ? 'page' : undefined}
              className={active ? FILTER_ACTIVE_CLASSES : FILTER_LINK_CLASSES.join(' ')}
            >
              {CATEGORY_LABELS[key][locale]}
            </Link>
          );
        })}
      </nav>

      {/* ── Category alert entry (task 5.1, change
          expand-alerts-accuracy-breakdowns): only when a canonical
          category is browsed — the watch targets that category, so the
          unfiltered view has no entry. The client island resolves the
          account's existing watches itself; the localized category label
          is resolved here (the server owns the vocabulary). ── */}
      {category !== undefined ? (
        <CategoryAlertAction
          category={category}
          categoryLabel={CATEGORY_LABELS[category][locale]}
        />
      ) : null}

      {/* ── Sort control (task 1.3) — a no-JS GET form so the sort order
          is URL state like category and page. A sort change resets to
          page 1 (no page field in the form); the category and the active
          search travel in hidden fields. The default order is a real
          option value (ALPHABETICAL — an explicit contract value) so the
          select always submits a value the API accepts. ── */}
      <form
        method="get"
        action="/products"
        data-testid="catalog-sort"
        className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-2"
      >
        {category !== undefined ? (
          <input type="hidden" name="category" value={category} />
        ) : null}
        {q !== undefined ? <input type="hidden" name="q" value={q} /> : null}
        <label
          htmlFor="catalog-sort-select"
          className="text-sm font-medium text-gray-700"
        >
          {t('sortLabel')}
        </label>
        <select
          id="catalog-sort-select"
          name="sort"
          defaultValue={sort}
          className="touch-target rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
        >
          {CATALOG_SORT_ORDERS.map((order) => (
            <option key={order} value={order}>
              {t(SORT_LABEL_KEYS[order])}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className={FILTER_LINK_CLASSES.join(' ')}
        >
          {t('sortApply')}
        </button>
      </form>

      {items.length === 0 ? (
        q !== undefined ? (
          /* ── Empty search (task 3.3): names the query, suggests a
              broader term, and offers category browse links. Category
              links keep the active sort and reset to page 1; choosing
              one is a browse action, so the search term clears. ── */
          <EmptyState
            title={t('searchEmptyTitle', { query: q })}
            description={t('searchEmptyBody')}
            action={
              <nav
                aria-label={t('browseCategoriesLabel')}
                className="flex flex-wrap justify-center gap-2"
              >
                {CANONICAL_CATEGORIES.map((key) => (
                  <Link
                    key={key}
                    href={catalogHref(key, undefined, sort, undefined)}
                    className="touch-target inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    {CATEGORY_LABELS[key][locale]}
                  </Link>
                ))}
              </nav>
            }
          />
        ) : (
          /* ── Honest empty state — a zero-result category (or a page
              beyond the range) is an answer, not an error ── */
          <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        )
      ) : (
        <>
          {/* ── Card grid — name, brand, category, ABV, volume, lowest
              observed price, merchant count; each card links to the
              product detail page ── */}
          <ul
            data-testid="catalog-grid"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {items.map((item: ProductSearchItem) => (
              <li key={item.id}>
                <Card as="article" padding="md" className="flex h-full flex-col gap-3">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <h2 className="min-w-0 break-words text-base font-semibold leading-snug">
                      <Link
                        href={`/products/${item.id}`}
                        className="text-primary-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                    </h2>
                    <Badge tone="neutral" size="sm">
                      {categoryLabel(item.category, locale)}
                    </Badge>
                  </div>
                  {item.brand ? (
                    <p className="text-sm text-gray-500">{item.brand}</p>
                  ) : null}
                  <p className="text-sm text-gray-700">
                    {[
                      // Shared attribute formatters (task 4.1): labelled
                      // volume ("50 cl") and percentage ABV ("4.7 %") —
                      // the previous `× 100` interpolation rendered float
                      // artifacts and the raw text leaked the bare litre
                      // value without a unit.
                      formatVolume(item.unitVolume),
                      formatAbv(item.alcoholByVolume),
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(' · ')}
                  </p>
                  <div className="mt-auto border-t border-gray-100 pt-2 text-sm">
                    {item.lowestPriceCents !== null ? (
                      <>
                        <p className="text-gray-500">{t('fromPriceLabel')}</p>
                        <p className="font-medium text-gray-900">
                          {formatEuro(item.lowestPriceCents, locale)}
                        </p>
                      </>
                    ) : (
                      <p className="text-gray-500">{t('noPrice')}</p>
                    )}
                    <p className="text-gray-500">
                      {t('merchantCount', { count: item.merchantCount })}
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* ── Pagination over the exact total; pages beyond the range
              are not linkable (prev/next degrade to disabled spans, the
              numbered set is exactly 1..totalPages) ── */}
          {totalPages > 1 ? (
            <nav
              aria-label={t('paginationNavLabel')}
              data-testid="catalog-pagination"
              className="mt-8 flex flex-wrap items-center gap-2"
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className={PAGE_LINK_CLASSES}>
                  {t('prevPage')}
                </Link>
              ) : (
                <span aria-disabled="true" className={PAGE_SPAN_CLASSES}>
                  {t('prevPage')}
                </span>
              )}
              {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                (pageNumber) =>
                  pageNumber === page ? (
                    <span
                      key={pageNumber}
                      aria-current="page"
                      className={PAGE_CURRENT_CLASSES}
                    >
                      {pageNumber}
                    </span>
                  ) : (
                    <Link
                      key={pageNumber}
                      href={pageHref(pageNumber)}
                      className={PAGE_LINK_CLASSES}
                    >
                      {pageNumber}
                    </Link>
                  ),
              )}
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className={PAGE_LINK_CLASSES}>
                  {t('nextPage')}
                </Link>
              ) : (
                <span aria-disabled="true" className={PAGE_SPAN_CLASSES}>
                  {t('nextPage')}
                </span>
              )}
              <p className="ml-2 text-sm text-gray-500">
                {t('pageStatus', { page, totalPages })}
              </p>
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}

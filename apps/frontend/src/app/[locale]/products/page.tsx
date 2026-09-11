// Namespace import: vitest's esbuild transform emits classic JSX
// (`React.createElement`) for these files (tsconfig jsx: preserve), so the
// React binding must exist at runtime, not just in Next's automatic runtime.
import * as React from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { request } from '@/lib/api';
import type { ProductSearchItem, ProductSearchResult } from '@/lib/types';
import { Badge, Card, EmptyState } from '@/components/ui';

/**
 * Catalog page (task 3.1, change product-catalog).
 *
 * A server component over the GET /api/v1/products browse contract
 * (committed in task 2.1): category and page live in the URL query
 * string and every control is a plain link (design D5), so each
 * (category, page) state renders and crawls without client-side
 * JavaScript. The 900 s revalidate matches the product-page server
 * fetches (product-dupes.ts, price-context.ts); offer data refreshes
 * hourly at most.
 *
 * Category validation is forgiving here (design D2): the page faces
 * humans and mistyped links, so an unknown ?category= value is treated
 * as absent and the unfiltered view renders. The API stays strict
 * (400 on unknown values), so the page resolves the parameter BEFORE
 * fetching and never sends a value the contract rejects.
 *
 * Copy note (task scope): the message catalogs belong to task 3.2, so
 * the catalog's new copy lives in the module-local FI/EN record below
 * and 3.2 migrates it. The category labels reuse the vocabulary already
 * established in the catalogs (EventPage.drinkType, the only place the
 * six canonical values carry both locales), and the ABV line reuses the
 * existing Common.abvValue key.
 *
 * @module CatalogPage
 */

/** Canonical product categories — mirrors PRODUCT_CATEGORIES in the D1
 *  schema (packages/data-platform), which the API validates against. The
 *  frontend cannot import that module (worker bindings), and the API is
 *  the enforcing authority; the page only needs the set to forgive
 *  unknown ?category= values before it fetches. */
const CANONICAL_CATEGORIES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

/** Locales the [locale] segment serves (fi is the default, en prefixed). */
type CatalogLocale = 'fi' | 'en';

/** Fixed catalog page size (design D5) and revalidate window. */
const CATALOG_PAGE_SIZE = 24;
const CATALOG_REVALIDATE_SECONDS = 900;

/**
 * Category labels — the established FI/EN vocabulary from the message
 * catalogs (EventPage.drinkType); 3.2 relocates the catalog's own copy.
 */
const CATEGORY_LABELS: Record<CanonicalCategory, Record<CatalogLocale, string>> = {
  beer: { fi: 'Olut', en: 'Beer' },
  wine_still: { fi: 'Makuuviini', en: 'Still wine' },
  wine_sparkling: { fi: 'Kuohuviini', en: 'Sparkling wine' },
  intermediate_products: {
    fi: 'Välituotteet (esim. vermutti)',
    en: 'Intermediate products (e.g. vermouth)',
  },
  other_fermented: { fi: 'Siideri ja pitkäjuoma', en: 'Cider and long drink' },
  spirits: { fi: 'Väkevät alkoholijuomat', en: 'Spirits' },
};

/** Catalog copy — factual statements only; the content-policy lint
 *  polices the vocabulary (design D6). */
interface CatalogCopy {
  readonly heading: string;
  readonly intro: string;
  readonly filterNavLabel: string;
  readonly allProducts: string;
  readonly fromPriceLabel: string;
  readonly noPrice: string;
  readonly merchantCount: string;
  readonly paginationNavLabel: string;
  readonly prevPage: string;
  readonly nextPage: string;
  readonly pageStatus: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly unavailableTitle: string;
  readonly unavailableBody: string;
}

const CATALOG_COPY: Record<CatalogLocale, CatalogCopy> = {
  fi: {
    heading: 'Tuotteet',
    intro: 'Rajahintalaskuriin sisältyvä tuoteluettelo havaittuine hintoineen.',
    filterNavLabel: 'Tuoteryhmä',
    allProducts: 'Kaikki tuotteet',
    fromPriceLabel: 'Halvin havaittu hinta',
    noPrice: 'Ei havaittuja hintoja',
    merchantCount: 'Myyjiä: {count}',
    paginationNavLabel: 'Sivutus',
    prevPage: 'Edellinen sivu',
    nextPage: 'Seuraava sivu',
    pageStatus: 'Sivu {page} / {totalPages}',
    emptyTitle: 'Ei näytettäviä tuotteita',
    emptyBody: 'Tähän näkymään ei ole tallentunut yhtään tuotetta.',
    unavailableTitle: 'Tuoteluetteloa ei voida näyttää juuri nyt',
    unavailableBody: 'Tuotetietojen haku ei onnistunut. Kokeile myöhemmin uudelleen.',
  },
  en: {
    heading: 'Products',
    intro: 'The product catalog behind the landed-cost calculator, with observed prices.',
    filterNavLabel: 'Category',
    allProducts: 'All products',
    fromPriceLabel: 'Lowest observed price',
    noPrice: 'No observed prices',
    merchantCount: 'Merchants: {count}',
    paginationNavLabel: 'Pagination',
    prevPage: 'Previous page',
    nextPage: 'Next page',
    pageStatus: 'Page {page} / {totalPages}',
    emptyTitle: 'No products to show',
    emptyBody: 'No products have been recorded for this view.',
    unavailableTitle: 'The catalog is not available right now',
    unavailableBody: 'The product data lookup did not succeed. Try again later.',
  },
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

/** Listing-API path for one (category, page) state — the query carries
 *  the canonical category only when one was resolved. */
function catalogQueryPath(
  category: CanonicalCategory | undefined,
  page: number,
): string {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
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
): Promise<ProductSearchResult | null> {
  try {
    return await request<ProductSearchResult>(catalogQueryPath(category, page), {
      next: { revalidate: CATALOG_REVALIDATE_SECONDS },
    });
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

/** Minimal {param} interpolation for the module-local copy record. */
function fill(
  template: string,
  values: Record<string, number | string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    values[key] === undefined ? `{${key}}` : String(values[key]),
  );
}

/** Localized label for a card's category; the raw value is the fallback
 *  so an out-of-vocabulary value can never render as an empty badge. */
function categoryLabel(category: string, locale: CatalogLocale): string {
  return (
    CATEGORY_LABELS[category as CanonicalCategory]?.[locale] ?? category
  );
}

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const FILTER_LINK_CLASSES = [
  'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
  'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
] as const;

const FILTER_ACTIVE_CLASSES =
  'inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors border-primary-600 bg-primary-600 text-white';

const PAGE_LINK_CLASSES =
  'inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50';

const PAGE_SPAN_CLASSES =
  'inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-medium text-gray-400';

const PAGE_CURRENT_CLASSES =
  'inline-flex items-center rounded-md border border-primary-600 bg-primary-600 px-3 py-1.5 text-sm font-medium text-white';

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

  const copy = CATALOG_COPY[locale];
  const tCommon = await getTranslations({ locale, namespace: 'Common' });

  const result = await getServerCatalogPage(category, page);

  if (result === null) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-2xl font-bold text-primary-700">
          {copy.heading}
        </h1>
        <EmptyState title={copy.unavailableTitle} description={copy.unavailableBody} />
      </main>
    );
  }

  const items = result.items;
  const totalPages = result.totalPages;

  const pageHref = (target: number): string =>
    category !== undefined
      ? `/products?category=${category}&page=${target}`
      : `/products?page=${target}`;

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="mb-2 text-2xl font-bold text-primary-700">{copy.heading}</h1>
      <p className="mb-6 text-sm leading-relaxed text-gray-500">{copy.intro}</p>

      {/* ── Category filter — URL state as plain links; every category
          link targets page 1 of that category (no page param) ── */}
      <nav
        aria-label={copy.filterNavLabel}
        data-testid="catalog-filter-row"
        className="mb-8 flex flex-wrap gap-2"
      >
        <Link
          href="/products"
          aria-current={category === undefined ? 'page' : undefined}
          className={
            category === undefined ? FILTER_ACTIVE_CLASSES : FILTER_LINK_CLASSES.join(' ')
          }
        >
          {copy.allProducts}
        </Link>
        {CANONICAL_CATEGORIES.map((key) => {
          const active = category === key;
          return (
            <Link
              key={key}
              href={`/products?category=${key}`}
              aria-current={active ? 'page' : undefined}
              className={active ? FILTER_ACTIVE_CLASSES : FILTER_LINK_CLASSES.join(' ')}
            >
              {CATEGORY_LABELS[key][locale]}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        /* ── Honest empty state — a zero-result category (or a page
            beyond the range) is an answer, not an error ── */
        <EmptyState title={copy.emptyTitle} description={copy.emptyBody} />
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
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold leading-snug">
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
                      item.unitVolume,
                      item.alcoholByVolume !== null
                        ? tCommon('abvValue', { value: item.alcoholByVolume * 100 })
                        : null,
                    ]
                      .filter((part): part is string => part !== null && part !== '')
                      .join(' · ')}
                  </p>
                  <div className="mt-auto border-t border-gray-100 pt-2 text-sm">
                    {item.lowestPriceCents !== null ? (
                      <>
                        <p className="text-gray-500">{copy.fromPriceLabel}</p>
                        <p className="font-medium text-gray-900">
                          {formatEuro(item.lowestPriceCents, locale)}
                        </p>
                      </>
                    ) : (
                      <p className="text-gray-500">{copy.noPrice}</p>
                    )}
                    <p className="text-gray-500">
                      {fill(copy.merchantCount, { count: item.merchantCount })}
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
              aria-label={copy.paginationNavLabel}
              data-testid="catalog-pagination"
              className="mt-8 flex flex-wrap items-center gap-2"
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className={PAGE_LINK_CLASSES}>
                  {copy.prevPage}
                </Link>
              ) : (
                <span aria-disabled="true" className={PAGE_SPAN_CLASSES}>
                  {copy.prevPage}
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
                  {copy.nextPage}
                </Link>
              ) : (
                <span aria-disabled="true" className={PAGE_SPAN_CLASSES}>
                  {copy.nextPage}
                </span>
              )}
              <p className="ml-2 text-sm text-gray-500">
                {fill(copy.pageStatus, { page, totalPages })}
              </p>
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}

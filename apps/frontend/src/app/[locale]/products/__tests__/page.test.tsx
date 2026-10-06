/**
 * Catalog page tests (task 3.1, change product-catalog).
 *
 * Renders the REAL async server component the way Next's RSC runtime
 * would — the page is awaited first, then the resolved element tree goes
 * through Testing Library (only Next server plumbing is mocked; the
 * ProductDupesPanel.test.tsx / page.ssr.test.tsx precedent). Pinned
 * contract:
 *
 *   1. Cards render name, brand, category badge, ABV, volume, the
 *      lowest observed price, and the merchant count, and link to
 *      /products/[id]. A product without offers shows honest absence —
 *      no price figure, never a placeholder.
 *   2. The listing fetch is the 2.1 browse contract: 900 s revalidate,
 *      fixed limit 24, 1-based page, and the category param only when a
 *      canonical value was resolved.
 *   3. The filter row carries all products plus exactly the six
 *      canonical categories with localized labels; every category link
 *      targets page 1 (no page param); the active option is marked.
 *   4. Windowed pagination (task 2.3, change
 *      savings-first-catalog-and-prefill): the strip renders prev/next,
 *      page 1 and the last page, and a clamped ±2 window with ellipsis
 *      gaps — a bounded anchor set even at live-catalog scale — and
 *      stays in bounds: prev/next degrade to disabled spans at the
 *      edges, the current page is not a link, and the page-status
 *      sentence remains.
 *   5. A zero-result view renders the shared EmptyState, not an empty
 *      grid or an error.
 *   6. Unknown ?category= values are forgiven (design D2): the page
 *      renders the unfiltered view and never sends the value to the API
 *      (the API would answer 400).
 *   7. Sort state (task 4.1, change catalog-first-run-polish): the
 *      default ALPHABETICAL stays out of the fetch and URLs
 *      (canonical-clean), superseding the first-impression-pass
 *      LOWEST_PRICE flip; LOWEST_PRICE remains selectable and
 *      URL-addressable as an explicit non-default sort; an unknown
 *      ?sort= value forgives to the default ordering — the strict 400
 *      lives at the API only.
 *   8. Savings figures (task 2.1, change
 *      savings-first-catalog-and-prefill): a covered card renders the
 *      snapshot's landed total, Alko reference, and factual gap beside
 *      the "from" price; an absent embed renders none of it.
 *
 * @module CatalogPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../page';
import { request } from '@/lib/api';
import type {
  ProductSavingsEmbed,
  ProductSearchItem,
  ProductSearchResult,
  ReliabilityStatus,
  UnitPriceResult,
  UnitPriceUnavailableReason,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — next-intl/server resolved from the locale's
// catalog with number values localized (next-intl formats {value} slots
// through Intl.NumberFormat), and the i18n Link rendered as a plain anchor
// carrying the href it was given.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const locale = typeof opts === 'string' ? 'fi' : (opts?.locale ?? 'fi');
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const table = (
      await import(locale === 'en' ? '@/messages/en.json' : '@/messages/fi.json')
    ).default as Record<string, unknown>;
    // Dotted-path resolution: a namespace-less (root) translator receives
    // full paths like 'Common.reliability.VERIFIED' (RELIABILITY_STATUS_META
    // labelKey contract), namespaced translators receive bare keys.
    const resolve = (path: string): unknown =>
      path.split('.').reduce<unknown>((node, part) => {
        if (node !== null && typeof node === 'object') {
          return (node as Record<string, unknown>)[part];
        }
        return undefined;
      }, table);
    return (key: string, values?: Record<string, unknown>) => {
      const value = resolve(ns === '' ? key : `${ns}.${key}`);
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      if (values === undefined) return value;
      return value.replace(/\{(\w+)\}/g, (_, k: string) => {
        const replacement = values[k];
        if (typeof replacement === 'number') {
          return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fi-FI').format(
            replacement,
          );
        }
        return replacement === undefined ? `{${k}}` : String(replacement);
      });
    };
  },
}));

vi.mock('@/i18n/navigation', () => ({
  Link: (
    props: { href?: unknown; children?: React.ReactNode } & Record<string, unknown>,
  ) => {
    const { href, children, ...rest } = props;
    return React.createElement('a', { ...rest, href: String(href ?? '') }, children);
  },
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const mockedRequest = vi.mocked(request);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function catalogItem(
  overrides: Partial<ProductSearchItem> = {},
): ProductSearchItem {
  return {
    id: 42,
    name: 'Kotikalja 0.5 l',
    brand: 'Panimo A',
    category: 'beer',
    alcoholByVolume: 0.047,
    // Canonical litre-denominated text (unit-integrity task 1.3).
    unitVolume: '0.5',
    containerType: 'can',
    lowestPriceCents: 199,
    merchantCount: 2,
    ...overrides,
  };
}

function catalogResult(
  items: ProductSearchItem[],
  extra: Partial<Omit<ProductSearchResult, 'items'>> = {},
): ProductSearchResult {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 24,
    totalPages: 1,
    ...extra,
  };
}

/** A computed €/g embed exactly as the listing API emits it (task 2.2). */
function computedEmbed(
  centsPerGram: number,
  priceReliability: ReliabilityStatus = 'VERIFIED',
): UnitPriceResult {
  return {
    status: 'computed',
    centsPerGram,
    ethanolGrams: 12.24,
    priceReliability,
  };
}

/** An unavailable €/g embed: explicit nulls plus the domain reason. */
function unavailableEmbed(
  reason: UnitPriceUnavailableReason = 'MISSING_PRICE',
): UnitPriceResult {
  return {
    status: 'unavailable',
    centsPerGram: null,
    ethanolGrams: null,
    reason,
  };
}

/**
 * A savings embed exactly as the listing API emits it (task 2.1,
 * savings-first-catalog-and-prefill): the default row is covered (a
 * reference exists) and cheaper than Alko.
 */
function savingsEmbed(
  overrides: Partial<ProductSavingsEmbed> = {},
): ProductSavingsEmbed {
  return {
    landedTotalCents: 1543,
    alkoReferenceCents: 2809,
    gapCents: -1266,
    gapBasisPoints: -4507,
    reliability: 'VERIFIED',
    confidence: 'HIGH',
    ...overrides,
  };
}

async function renderCatalog(
  searchParams: Record<string, string | string[] | undefined> = {},
  locale = 'fi',
): Promise<void> {
  // NextIntlClientProvider wraps the tree because category views embed
  // the CategoryAlertAction client island (task 5.1), which reads the
  // catalogs through useTranslations — the server-side getTranslations
  // mock above does not cover it.
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={
        locale === 'en'
          ? (await import('@/messages/en.json')).default
          : (await import('@/messages/fi.json')).default
      }
    >
      {await ProductsPage({
        params: Promise.resolve({ locale }),
        searchParams: Promise.resolve(searchParams),
      })}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  // The page renders the category-alert entry island (task 5.1) on
  // category views; its account-alerts read is routed separately from
  // the listing fetch.
  mockedRequest.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/account/alerts')) return [];
    return catalogResult([catalogItem()]);
  });
});

// ---------------------------------------------------------------------------
// Card rows
// ---------------------------------------------------------------------------

describe('ProductsPage cards', () => {
  it('renders each product card with name, brand, category, ABV, volume, price, and merchant count', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem(),
        catalogItem({
          id: 7,
          name: 'Clear Gin 0.5 l',
          brand: 'Distillery B',
          category: 'spirits',
          alcoholByVolume: 0.4,
          lowestPriceCents: 2490,
          merchantCount: 3,
        }),
      ]),
    );

    await renderCatalog();

    const grid = screen.getByTestId('catalog-grid');
    const beerCard = within(grid).getByText('Kotikalja 0.5 l').closest('article');
    expect(beerCard).toHaveTextContent('Panimo A');
    expect(beerCard).toHaveTextContent('Olut');
    // Volume renders labelled in cl below a litre (formatVolume, task 4.1).
    expect(beerCard).toHaveTextContent('50 cl');
    // ABV renders as a percentage via formatAbv (task 4.1) — the stored
    // fraction 0.047 never leaks raw, and no float artifact survives.
    expect(beerCard).toHaveTextContent('4.7 %');
    expect(beerCard).toHaveTextContent('Halvin havaittu hinta');
    expect(beerCard).toHaveTextContent('1,99 €');
    expect(beerCard).toHaveTextContent('Myyjiä: 2');

    const ginCard = within(grid).getByText('Clear Gin 0.5 l').closest('article');
    expect(ginCard).toHaveTextContent('Väkevät alkoholijuomat');
    expect(ginCard).toHaveTextContent('40 %');
    expect(ginCard).toHaveTextContent('24,90 €');
  });

  it('links every card to the product detail page', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem(), catalogItem({ id: 7, name: 'Clear Gin 0.5 l' })]),
    );

    await renderCatalog();

    expect(screen.getByRole('link', { name: 'Kotikalja 0.5 l' })).toHaveAttribute(
      'href',
      '/products/42',
    );
    expect(screen.getByRole('link', { name: 'Clear Gin 0.5 l' })).toHaveAttribute(
      'href',
      '/products/7',
    );
  });

  it('shows honest absence for a product without offers — no price, no placeholder', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({ lowestPriceCents: null, merchantCount: 0 }),
      ]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).toHaveTextContent('Ei havaittuja hintoja');
    expect(card).toHaveTextContent('Myyjiä: 0');
    // Never a placeholder price figure.
    expect(card).not.toHaveTextContent('€');
  });

  it('fetches the browse contract: 900 s revalidate, limit 24, page 1, no category', async () => {
    await renderCatalog();

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?page=1&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
  });

  it('passes a resolved category and page through to the fetch and URL state', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 60, page: 2, totalPages: 3 }),
    );

    await renderCatalog({ category: 'beer', page: '2' });

    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?category=beer&page=2&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Category filter row
// ---------------------------------------------------------------------------

describe('ProductsPage category filter', () => {
  it('lists all products plus exactly the six canonical categories with FI labels', async () => {
    await renderCatalog();

    const row = screen.getByTestId('catalog-filter-row');
    const links = within(row).getAllByRole('link');
    expect(links).toHaveLength(7);
    expect(within(row).getByRole('link', { name: 'Kaikki tuotteet' })).toHaveAttribute(
      'href',
      '/products',
    );
    for (const label of [
      'Olut',
      'Makuuviini',
      'Kuohuviini',
      'Välituotteet (esim. vermutti)',
      'Siideri ja pitkäjuoma',
      'Väkevät alkoholijuomat',
    ]) {
      expect(within(row).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('targets every category link at page 1 of that category (no page param)', async () => {
    // The visitor is deep in the unfiltered listing; switching category
    // must not carry the current page along.
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 100, page: 3, totalPages: 5 }),
    );

    await renderCatalog({ page: '3' });

    const row = screen.getByTestId('catalog-filter-row');
    expect(
      within(row).getByRole('link', { name: 'Olut' }),
    ).toHaveAttribute('href', '/products?category=beer');
    expect(
      within(row).getByRole('link', { name: 'Makuuviini' }),
    ).toHaveAttribute('href', '/products?category=wine_still');
    expect(
      within(row).getByRole('link', { name: 'Kaikki tuotteet' }),
    ).toHaveAttribute('href', '/products');
  });

  it('marks the active filter option and no other', async () => {
    await renderCatalog({ category: 'beer' });

    const row = screen.getByTestId('catalog-filter-row');
    expect(within(row).getByRole('link', { name: 'Olut' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(row).getByRole('link', { name: 'Kaikki tuotteet' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(row).getByRole('link', { name: 'Väkevät alkoholijuomat' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('renders EN labels for the EN locale', async () => {
    await renderCatalog({}, 'en');

    const row = screen.getByTestId('catalog-filter-row');
    expect(within(row).getByRole('link', { name: 'All products' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Still wine' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Spirits' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Products' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('ProductsPage pagination', () => {
  it('links the exact page range over the true total', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 60, page: 2, totalPages: 3 }),
    );

    await renderCatalog({ page: '2' });

    const nav = screen.getByTestId('catalog-pagination');
    // Page 1 is the base URL — the page parameter is the default and is
    // omitted (task 1.3 href builder).
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/products',
    );
    expect(within(nav).getByRole('link', { name: '3' })).toHaveAttribute(
      'href',
      '/products?page=3',
    );
    // The current page is an indicator, not a link.
    expect(within(nav).getByText('2')).not.toHaveAttribute('href');
    expect(nav).toHaveTextContent('Sivu 2 / 3');
  });

  it('keeps the category in pagination hrefs and disables prev at the first page', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 60, page: 1, totalPages: 3 }),
    );

    await renderCatalog({ category: 'beer' });

    const nav = screen.getByTestId('catalog-pagination');
    const prev = within(nav).getByText('Edellinen sivu');
    expect(prev).not.toHaveAttribute('href');
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).getByRole('link', { name: 'Seuraava sivu' })).toHaveAttribute(
      'href',
      '/products?category=beer&page=2',
    );
    expect(within(nav).getByRole('link', { name: '2' })).toHaveAttribute(
      'href',
      '/products?category=beer&page=2',
    );
  });

  it('disables next at the last page', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 60, page: 3, totalPages: 3 }),
    );

    await renderCatalog({ page: '3' });

    const nav = screen.getByTestId('catalog-pagination');
    const next = within(nav).getByText('Seuraava sivu');
    expect(next).not.toHaveAttribute('href');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(within(nav).getByRole('link', { name: 'Edellinen sivu' })).toHaveAttribute(
      'href',
      '/products?page=2',
    );
  });

  it('renders no pagination when everything fits on one page', async () => {
    await renderCatalog();

    expect(screen.queryByTestId('catalog-pagination')).not.toBeInTheDocument();
  });

  it('caps the anchors and keeps both edges reachable on a many-page catalog', async () => {
    // Live-catalog scale: the old render-every-page strip produced
    // ~443 anchors; the windowed one stays bounded.
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], {
        total: 10632,
        page: 200,
        totalPages: 443,
      }),
    );

    await renderCatalog({ page: '200' });

    const nav = screen.getByTestId('catalog-pagination');
    expect(within(nav).getAllByRole('link').length).toBeLessThanOrEqual(9);

    // Edges: page 1 canonical-clean, the last page always linked.
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/products',
    );
    expect(within(nav).getByRole('link', { name: '443' })).toHaveAttribute(
      'href',
      '/products?page=443',
    );

    // The ±2 window rides with the current page; far pages stay unlinked.
    for (const number of ['198', '199', '201', '202']) {
      expect(within(nav).getByRole('link', { name: number })).toHaveAttribute(
        'href',
        `/products?page=${number}`,
      );
    }
    expect(within(nav).queryByRole('link', { name: '2' })).not.toBeInTheDocument();

    // The current page is an indicator, not a link; prev/next step ±1.
    expect(within(nav).getByText('200')).not.toHaveAttribute('href');
    expect(
      within(nav).getByRole('link', { name: 'Edellinen sivu' }),
    ).toHaveAttribute('href', '/products?page=199');
    expect(
      within(nav).getByRole('link', { name: 'Seuraava sivu' }),
    ).toHaveAttribute('href', '/products?page=201');

    // Ellipsis gaps are decorative spans, never links.
    const gaps = within(nav).getAllByText('…');
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) {
      expect(gap).toHaveAttribute('aria-hidden', 'true');
      expect(gap).not.toHaveAttribute('href');
    }

    // The page-status sentence survives the windowed control.
    expect(nav).toHaveTextContent('Sivu 200 / 443');
  });

  it('slides the window to hug the last page and disables next there', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], {
        total: 10632,
        page: 443,
        totalPages: 443,
      }),
    );

    await renderCatalog({ page: '443' });

    const nav = screen.getByTestId('catalog-pagination');
    // The shifted window keeps the tail reachable without far pages.
    expect(within(nav).getByRole('link', { name: '441' })).toHaveAttribute(
      'href',
      '/products?page=441',
    );
    expect(
      within(nav).queryByRole('link', { name: '438' }),
    ).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/products',
    );
    const next = within(nav).getByText('Seuraava sivu');
    expect(next).not.toHaveAttribute('href');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(nav).getByRole('link', { name: 'Edellinen sivu' }),
    ).toHaveAttribute('href', '/products?page=442');
  });
});

// ---------------------------------------------------------------------------
// Sort state (task 4.1, change catalog-first-run-polish): the catalog's
// default order is ALPHABETICAL, superseding the first-impression-pass
// LOWEST_PRICE flip. The default stays out of the fetch and URLs
// (canonical-clean href builder); an explicit non-default sort —
// LOWEST_PRICE among them — travels through every control; an unknown
// ?sort= value forgives to the default — the API's strict 400 never
// happens.
// ---------------------------------------------------------------------------

describe('ProductsPage sort state (task 4.1)', () => {
  it('defaults to ALPHABETICAL: the select shows the name order and the default stays out of the fetch and links', async () => {
    await renderCatalog();

    const select = screen.getByLabelText('Järjestys') as HTMLSelectElement;
    expect(select.value).toBe('ALPHABETICAL');
    // The API's absent-sort default is the name order too, so the
    // canonical-clean fetch omits sort entirely.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?page=1&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
    // Category links stay canonical-clean: the default sort is omitted.
    const row = screen.getByTestId('catalog-filter-row');
    expect(
      within(row).getByRole('link', { name: 'Olut' }),
    ).toHaveAttribute('href', '/products?category=beer');
  });

  it('carries an explicit non-default sort through the fetch, the links, and the control state (LOWEST_PRICE stays URL-addressable)', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { total: 60, page: 1, totalPages: 3 }),
    );

    await renderCatalog({ sort: 'LOWEST_PRICE' });

    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?sort=LOWEST_PRICE&page=1&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
    const select = screen.getByLabelText('Järjestys') as HTMLSelectElement;
    expect(select.value).toBe('LOWEST_PRICE');
    const nav = screen.getByTestId('catalog-pagination');
    expect(
      within(nav).getByRole('link', { name: '2' }),
    ).toHaveAttribute('href', '/products?sort=LOWEST_PRICE&page=2');
  });

  it('forgives an unknown sort value: the default name ordering renders and nothing unknown reaches the API', async () => {
    await renderCatalog({ sort: 'PROMOTED' });

    const select = screen.getByLabelText('Järjestys') as HTMLSelectElement;
    expect(select.value).toBe('ALPHABETICAL');
    // The strict API would 400 — the page resolves the parameter before
    // fetching and sends the default (omitted) instead of the value.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?page=1&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
    expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Empty state and forgiving category
// ---------------------------------------------------------------------------

describe('ProductsPage empty state and forgiveness', () => {
  it('renders the shared EmptyState for a zero-result view, with no grid or pagination', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([], { total: 0, page: 1, totalPages: 0 }),
    );

    await renderCatalog({ category: 'wine_sparkling' });

    const empty = screen.getByRole('status');
    expect(empty).toHaveAttribute('data-state', 'empty');
    expect(empty).toHaveTextContent('Ei näytettäviä tuotteita');
    expect(screen.queryByTestId('catalog-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('catalog-pagination')).not.toBeInTheDocument();
  });

  it('treats an unknown category as absent: unfiltered fetch, unfiltered view', async () => {
    mockedRequest.mockResolvedValue(catalogResult([catalogItem()]));

    await renderCatalog({ category: 'moonshine' });

    // The strict API would 400 an unknown value — the page forgives
    // BEFORE fetching, so the listing request is the unfiltered one.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/api/v1/products?page=1&limit=24',
      {
        headers: { 'x-age-confirmed': 'server-prerender' },
        next: { revalidate: 900 },
      },
    );
    const row = screen.getByTestId('catalog-filter-row');
    expect(within(row).getByRole('link', { name: 'Kaikki tuotteet' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('catalog-grid')).toBeInTheDocument();
  });

  it('degrades to an explained state when the listing fetch fails', async () => {
    mockedRequest.mockRejectedValue(new Error('backend unreachable'));

    await renderCatalog();

    // Human server-error state (task 3.3): no raw error, a retry link
    // targeting the same state.
    expect(screen.getByText('Jokin meni pieleen')).toBeInTheDocument();
    expect(screen.getByText('Yritä hetken kuluttua uudelleen.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Yritä uudelleen' }),
    ).toHaveAttribute('href', '/products');
    expect(screen.queryByTestId('catalog-grid')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Category alert entry (task 5.1, change expand-alerts-accuracy-breakdowns)
// ---------------------------------------------------------------------------

describe('ProductsPage category alert entry', () => {
  it('renders the alert entry naming the browsed category, with the create form', async () => {
    await renderCatalog({ category: 'beer' });

    const entry = await screen.findByTestId('category-alert-action');
    expect(
      within(entry).getByTestId('category-alert-category'),
    ).toHaveTextContent('Tuoteryhmä: Olut');
    expect(
      await within(entry).findByTestId('category-alert-create'),
    ).toBeInTheDocument();
  });

  it('renders the manage view when the account already watches this category', async () => {
    mockedRequest.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v1/account/alerts')) {
        return [
          {
            id: 31,
            productId: null,
            kind: 'CATEGORY',
            category: 'beer',
            thresholdCents: 1500,
            status: 'active',
            createdAt: '2026-08-01T10:00:00.000Z',
            updatedAt: '2026-08-02T10:00:00.000Z',
          },
        ];
      }
      return catalogResult([catalogItem()]);
    });

    await renderCatalog({ category: 'beer' });

    const entry = await screen.findByTestId('category-alert-action');
    expect(
      await within(entry).findByTestId('category-alert-manage'),
    ).toBeInTheDocument();
    expect(entry).toHaveTextContent('Hintaraja 15.00 €');
  });

  it('renders no alert entry on the unfiltered view', async () => {
    await renderCatalog();

    expect(screen.queryByTestId('category-alert-action')).not.toBeInTheDocument();
  });

  it('renders no alert entry for an unknown category (nothing is browsed)', async () => {
    await renderCatalog({ category: 'moonshine' });

    expect(screen.queryByTestId('category-alert-action')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Zero-result did-you-mean (task 3.3, change
// finnish-first-client-experience): the API attaches `suggestion` only
// when a ranked search returned zero items — the chip runs the suggested
// query as URL state while the input keeps the customer's spelling.
// ---------------------------------------------------------------------------

describe('ProductsPage did-you-mean suggestion (task 3.3)', () => {
  it('renders the chip on a zero-result search and links the suggested query', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([], { total: 0, totalPages: 0, suggestion: 'Koskenkorva' }),
    );

    await renderCatalog({ q: 'koskenkrova' });

    const box = screen.getByTestId('catalog-suggestion');
    expect(box.textContent).toContain('Tarkoititko:');
    const chip = within(box).getByRole('link');
    expect(chip).toHaveTextContent('Koskenkorva');
    // Page 1 of the suggested query; category/sort defaults stay out of
    // the URL (the canonical-clean href builder).
    expect(chip.getAttribute('href')).toBe('/products?q=Koskenkorva');
    // The customer's original query stays in the input — the suggestion
    // never rewrites what was typed.
    expect(
      (screen.getByLabelText('Haku') as HTMLInputElement).value,
    ).toBe('koskenkrova');
  });

  it('renders no chip when results exist or the response carries no suggestion', async () => {
    // Results present, suggestion attached — the banner requires zero
    // results, and the API never sends this shape; render nothing.
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem()], { suggestion: 'Koskenkorva' }),
    );
    await renderCatalog({ q: 'karhu' });
    expect(screen.queryByTestId('catalog-suggestion')).toBeNull();

    // Zero results without a candidate — the plain empty state only.
    mockedRequest.mockResolvedValue(
      catalogResult([], { total: 0, totalPages: 0 }),
    );
    await renderCatalog({ q: 'pöppönen' });
    expect(screen.queryByTestId('catalog-suggestion')).toBeNull();
    expect(screen.getByText('Ei tuloksia haulle "pöppönen"')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// €/g chip and single-seller framing (task 2.3, change
// honest-trust-surfaces): the chip renders only for a computed listing
// embed — an unavailable or absent embed renders nothing at all — and a
// single-seller card replaces the "Myyjiä: 1" count with the
// tracked-price framing (design D6).
// ---------------------------------------------------------------------------

describe('ProductsPage €/g chip and single-seller framing (task 2.3)', () => {
  it('renders the chip with value, unit, and the reliability label on a computed embed', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({ merchantCount: 2, eurPerGram: computedEmbed(16.26) }),
      ]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    // Value in the shared €/g presentation (toFixed(2) + localized unit),
    // the same format the compare cell and the value ranking use.
    expect(card).toHaveTextContent('16.26 snt/g');
    // Reliability rides with the canonical badge label — never color alone.
    expect(card).toHaveTextContent('Vahvistettu');
    // Multi-seller counts are untouched by the chip.
    expect(card).toHaveTextContent('Myyjiä: 2');
  });

  it('renders nothing for the chip on an unavailable embed — no placeholder, no zero', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({ eurPerGram: unavailableEmbed('MISSING_PRICE') }),
      ]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).not.toHaveTextContent('snt/g');
    // No placeholder dash and no substituted zero where the chip would be.
    expect(card).not.toHaveTextContent('—');
    expect(card).not.toHaveTextContent('0.00');
    // The rest of the card is unchanged.
    expect(card).toHaveTextContent('1,99 €');
    expect(card).toHaveTextContent('Myyjiä: 2');
  });

  it('renders nothing for the chip when the embed is absent (pre-embed cached row)', async () => {
    mockedRequest.mockResolvedValue(catalogResult([catalogItem()]));

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).not.toHaveTextContent('snt/g');
    expect(card).not.toHaveTextContent('Vahvistettu');
    expect(card).toHaveTextContent('Myyjiä: 2');
  });

  it('replaces the seller line with the tracked-price framing for exactly one seller', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({ merchantCount: 1, eurPerGram: computedEmbed(16.26) }),
      ]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).toHaveTextContent('Seurattu hinta');
    expect(card).not.toHaveTextContent('Myyjiä: 1');
  });

  it('keeps the seller count for multi-seller and zero-offer cards', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({ id: 1, name: 'Multi Seller', merchantCount: 3 }),
        catalogItem({
          id: 2,
          name: 'No Offers',
          lowestPriceCents: null,
          merchantCount: 0,
        }),
      ]),
    );

    await renderCatalog();

    const multi = screen.getByText('Multi Seller').closest('article');
    expect(multi).toHaveTextContent('Myyjiä: 3');
    expect(multi).not.toHaveTextContent('Seurattu hinta');
    const none = screen.getByText('No Offers').closest('article');
    expect(none).toHaveTextContent('Myyjiä: 0');
    expect(none).not.toHaveTextContent('Seurattu hinta');
  });

  it('renders EN chip copy and framing for the EN locale', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({
          merchantCount: 1,
          eurPerGram: computedEmbed(9.4, 'ESTIMATED'),
        }),
      ]),
    );

    await renderCatalog({}, 'en');

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).toHaveTextContent('9.40 ¢/g');
    expect(card).toHaveTextContent('Estimated');
    expect(card).toHaveTextContent('Tracked price');
    expect(card).not.toHaveTextContent('Merchants: 1');
  });
});

// ---------------------------------------------------------------------------
// Savings figures (task 2.1, change savings-first-catalog-and-prefill):
// a covered card renders the snapshot's landed total, Alko reference, and
// factual gap beside the "from" price; both gap directions state the fact
// the same way; an absent embed renders none of it — the €/g chip
// precedent of honest absence.
// ---------------------------------------------------------------------------

describe('ProductsPage savings figures (task 2.1)', () => {
  it('renders landed total, Alko reference, gap, and reliability beside the from price on a covered card', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem({ savings: savingsEmbed() })]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    // The /savings vocabulary, both labels present.
    expect(card).toHaveTextContent('Kokonaishinta Suomeen');
    expect(card).toHaveTextContent('Alkon vertailuhinta');
    // Figures: landed 15,43 € and reference 28,09 €.
    expect(card).toHaveTextContent('15,43 €');
    expect(card).toHaveTextContent('28,09 €');
    // The gap sentence names the direction factually.
    expect(card).toHaveTextContent('halvempi kuin Alkon vertailuhinta');
    // The input figure's reliability rides with the canonical badge label.
    expect(card).toHaveTextContent('Vahvistettu');
    // The "from" price line is untouched.
    expect(card).toHaveTextContent('Halvin havaittu hinta');
    expect(card).toHaveTextContent('1,99 €');
  });

  it('states the dearer direction with the same factual framing as the cheaper one', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({
          id: 1,
          name: 'Cheaper Import',
          savings: savingsEmbed(),
        }),
        catalogItem({
          id: 2,
          name: 'Dearer Import',
          savings: savingsEmbed({
            landedTotalCents: 3409,
            alkoReferenceCents: 2809,
            gapCents: 600,
            gapBasisPoints: 2136,
            reliability: 'ESTIMATED',
            confidence: 'MEDIUM',
          }),
        }),
      ]),
    );

    await renderCatalog();

    const cheaper = screen.getByText('Cheaper Import').closest('article');
    expect(cheaper).toHaveTextContent('12,66 €');
    expect(cheaper).toHaveTextContent('halvempi kuin Alkon vertailuhinta');
    expect(cheaper).not.toHaveTextContent('kalliimpi kuin Alkon vertailuhinta');

    const dearer = screen.getByText('Dearer Import').closest('article');
    expect(dearer).toHaveTextContent('6,00 €');
    expect(dearer).toHaveTextContent('kalliimpi kuin Alkon vertailuhinta');
    expect(dearer).not.toHaveTextContent('halvempi kuin Alkon vertailuhinta');
    // The embed's own reliability labels the dearer figures.
    expect(dearer).toHaveTextContent('Arvioitu');
  });

  it('renders no savings element when the embed is absent — no placeholder, no zero', async () => {
    mockedRequest.mockResolvedValue(catalogResult([catalogItem()]));

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(screen.queryByTestId('card-savings')).toBeNull();
    expect(card).not.toHaveTextContent('Kokonaishinta Suomeen');
    expect(card).not.toHaveTextContent('Alkon vertailuhinta');
    expect(card).not.toHaveTextContent('halvempi kuin Alkon vertailuhinta');
    expect(card).not.toHaveTextContent('kalliimpi kuin Alkon vertailuhinta');
    // The rest of the card is unchanged.
    expect(card).toHaveTextContent('1,99 €');
    expect(card).toHaveTextContent('Myyjiä: 2');
  });

  it('renders the landed total alone when the snapshot has no Alko reference — no gap without its reference', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([
        catalogItem({
          savings: savingsEmbed({ alkoReferenceCents: null }),
        }),
      ]),
    );

    await renderCatalog();

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).toHaveTextContent('Kokonaishinta Suomeen');
    expect(card).toHaveTextContent('15,43 €');
    expect(card).not.toHaveTextContent('Alkon vertailuhinta');
    expect(card).not.toHaveTextContent('halvempi kuin Alkon vertailuhinta');
  });

  it('renders EN savings copy for the EN locale', async () => {
    mockedRequest.mockResolvedValue(
      catalogResult([catalogItem({ savings: savingsEmbed() })]),
    );

    await renderCatalog({}, 'en');

    const card = screen.getByText('Kotikalja 0.5 l').closest('article');
    expect(card).toHaveTextContent('Landed total to Finland');
    expect(card).toHaveTextContent('Alko reference price');
    expect(card).toHaveTextContent('cheaper than the Alko reference price');
  });
});

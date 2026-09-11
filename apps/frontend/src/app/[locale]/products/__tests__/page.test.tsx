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
 *   4. Pagination links the exact page range and stays in bounds —
 *      prev/next degrade to disabled spans at the edges; current page is
 *      not a link.
 *   5. A zero-result view renders the shared EmptyState, not an empty
 *      grid or an error.
 *   6. Unknown ?category= values are forgiven (design D2): the page
 *      renders the unfiltered view and never sends the value to the API
 *      (the API would answer 400).
 *
 * @module CatalogPageTest
 */
// @vitest-environment jsdom

import * as React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from '../page';
import { request } from '@/lib/api';
import type { ProductSearchItem, ProductSearchResult } from '@/lib/types';

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
    return (key: string, values?: Record<string, unknown>) => {
      const value = (table[ns] as Record<string, unknown> | undefined)?.[key];
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
    unitVolume: '0.5 l',
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

async function renderCatalog(
  searchParams: Record<string, string | string[] | undefined> = {},
  locale = 'fi',
): Promise<void> {
  render(
    await ProductsPage({
      params: Promise.resolve({ locale }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(catalogResult([catalogItem()]));
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
    expect(beerCard).toHaveTextContent('0.5 l');
    // ABV fraction × 100 through the existing Common.abvValue key.
    expect(beerCard).toHaveTextContent('4,7 til-%');
    expect(beerCard).toHaveTextContent('Halvin havaittu hinta');
    expect(beerCard).toHaveTextContent('1,99 €');
    expect(beerCard).toHaveTextContent('Myyjiä: 2');

    const ginCard = within(grid).getByText('Clear Gin 0.5 l').closest('article');
    expect(ginCard).toHaveTextContent('Väkevät alkoholijuomat');
    expect(ginCard).toHaveTextContent('40 til-%');
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
    expect(within(nav).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      '/products?page=1',
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

    expect(screen.getByText('Tuoteluetteloa ei voida näyttää juuri nyt')).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid')).not.toBeInTheDocument();
  });
});

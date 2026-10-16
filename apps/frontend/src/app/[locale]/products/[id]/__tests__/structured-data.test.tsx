/**
 * Product-page structured-data + metadata route tests (seo-aeo-agent-
 * surfaces 1.1 and 1.4).
 *
 * Renders the REAL route modules the way Next would — the physical FI
 * route `/tuotteet/<id>` and the `[locale]` adapter — and pins the
 * machine-readable contract in the served HTML:
 *
 *   - both routes embed the `application/ld+json` Product graph and the
 *     localized BreadcrumbList (the shared-module inheritance, design D2);
 *   - the graph never carries Offer/AggregateOffer/AggregateRating or
 *     review semantics, even for a product WITH observed offers (design D1);
 *   - absent attributes stay absent (no EAN → no gtin13, no updatedAt →
 *     no dateModified, unknown container key → no container entry);
 *   - the visible breadcrumb trail links the same localized destinations;
 *   - the enriched meta title carries the identifying tokens through the
 *     shared {details} composition, and the degraded fallback stays
 *     byte-identical.
 *
 * Harness: the page.test.tsx lineage (real async server component awaited
 * first, only Next server plumbing and the fetch-holding children
 * mocked), with the locale-steered catalog resolver so EN assertions run
 * against the real en catalog.
 *
 * @module ProductStructuredDataRouteTest
 */
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProductPage, { generateMetadata } from '../page';
import FiProductPage from '@/app/tuotteet/[id]/page';
import { getServerProductDetail } from '@/lib/server-api';
import { SITE_URL } from '@/lib/api';
import type { ProductDetailResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Mocked Next server plumbing — locale-steered catalog resolution.
// ---------------------------------------------------------------------------

vi.mock('next-intl/server', () => ({
  setRequestLocale: () => undefined,
  getTranslations: async (
    opts?: string | { locale?: string; namespace?: string },
  ) => {
    const ns = typeof opts === 'string' ? opts : (opts?.namespace ?? '');
    const locale =
      (typeof opts === 'object' && opts?.locale) === 'en' ? 'en' : 'fi';
    const table = (await import(`@/messages/${locale}.json`))
      .default as Record<string, unknown>;
    return (key: string, values?: Record<string, unknown>) => {
      const value = key.split('.').reduce<unknown>(
        (node, part) =>
          node !== null && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        table[ns],
      );
      if (typeof value !== 'string') return `__MISSING_${ns}.${key}__`;
      if (values === undefined) return value;
      return value.replace(/\{(\w+)\}/g, (_, k: string) =>
        values[k] === undefined ? `{${k}}` : String(values[k]),
      );
    };
  },
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

vi.mock('@/lib/server-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server-api')>();
  return {
    ...actual,
    getServerProductDetail: vi.fn(),
  };
});

// The fetch-holding children are stubbed to sync markers (their contracts
// have their own test files) — page.test.tsx precedent.
vi.mock('../components/PriceHistoryChart', () => ({ default: () => null }));
vi.mock('../../../components/MerchantWarningNotice', () => ({
  default: () => null,
}));
vi.mock('../components/ProductAlertAction', () => ({ default: () => null }));
vi.mock('../components/ProductFavoriteAction', () => ({ default: () => null }));
vi.mock('../components/ProductDupesPanel', () => ({ default: () => null }));
vi.mock('../components/ProductPriceContextLine', () => ({
  default: () => null,
}));

const mockedGetServerProductDetail = vi.mocked(getServerProductDetail);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full-attribute product: EAN, ABV, volume, container, updatedAt. */
function detailResponse(
  product: Partial<ProductDetailResponse['product']> = {},
): ProductDetailResponse {
  return {
    product: {
      id: 42,
      name: 'Kotikalja 0.5 l',
      manufacturer: 'Panimo A',
      brand: 'Panimo A',
      category: 'beer',
      alcoholByVolume: 0.047,
      unitVolume: '0.5',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: false,
      ean: '6410405248961',
      updatedAt: '2026-10-01T12:00:00.000Z',
      ...product,
    },
    // Observed offers ARE present — the graph must still carry zero
    // offer semantics (the D1 distinction the change pins).
    offers: [
      {
        id: 12,
        merchant: 'alko',
        country: 'FI',
        priceCents: 1999,
        currency: 'EUR',
        availability: 'in_stock',
        sourceUrl: null,
        observedAt: '2026-10-01T06:00:00.000Z',
        reliabilityStatus: 'VERIFIED',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// HTML helpers — the ld+json scripts and a deep key/type walk
// ---------------------------------------------------------------------------

/** Every JSON-LD graph in the served HTML, parsed. */
function ldGraphs(): Array<Record<string, unknown>> {
  return [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].map((script) => JSON.parse(script.textContent ?? '') as Record<string, unknown>);
}

function findGraph(type: string): Record<string, unknown> {
  const graph = ldGraphs().find((g) => g['@type'] === type);
  expect(graph, `expected a ${type} graph in the HTML`).toBeDefined();
  return graph as Record<string, unknown>;
}

/** Every object key in the graph, recursively. */
function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}

/** Every `@type` value in the graph, recursively. */
function collectTypes(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === '@type' && typeof child === 'string') out.add(child);
      collectTypes(child, out);
    }
  }
  return out;
}

beforeEach(() => {
  cleanup();
  mockedGetServerProductDetail.mockReset();
  // The unmocked getServer* reads ride global fetch (serverRequest's URL
  // fallback) — default to the honest degradation path.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('not mocked in this suite')),
  );
});

// ---------------------------------------------------------------------------
// 1.1 — the graphs ride BOTH routes' HTML
// ---------------------------------------------------------------------------

describe('Product JSON-LD and BreadcrumbList — both routes (1.1)', () => {
  it('the physical FI /tuotteet/<id> route embeds both graphs', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(await FiProductPage({ params: Promise.resolve({ id: '42' }) }));

    const productGraph = findGraph('Product');
    expect(productGraph.name).toBe('Kotikalja 0.5 l');
    expect(productGraph.url).toBe(`${SITE_URL}/tuotteet/42`);
    expect(findGraph('BreadcrumbList')).toBeDefined();
  });

  it('the [locale] route embeds both graphs in its locale (en)', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(
      await ProductPage({
        params: Promise.resolve({ locale: 'en', id: '42' }),
      }),
    );

    const productGraph = findGraph('Product');
    expect(productGraph.name).toBe('Kotikalja 0.5 l');
    expect(productGraph.url).toBe(`${SITE_URL}/en/products/42`);
    expect(findGraph('BreadcrumbList')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 1.1 — no offer semantics, even with observed offers on the payload
// ---------------------------------------------------------------------------

describe('no offer semantics in the served graphs (1.1)', () => {
  it.each([
    { label: 'FI route', render: () => FiProductPage({ params: Promise.resolve({ id: '42' }) }) },
    {
      label: 'EN route',
      render: () =>
        ProductPage({ params: Promise.resolve({ locale: 'en', id: '42' }) }),
    },
  ])('zero Offer/AggregateOffer/AggregateRating/review nodes — $label', async ({ render: renderRoute }) => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(await renderRoute());

    for (const graph of ldGraphs()) {
      const types = collectTypes(graph);
      for (const banned of ['Offer', 'AggregateOffer', 'AggregateRating', 'Review']) {
        expect(types.has(banned)).toBe(false);
      }
      const keys = collectKeys(graph);
      for (const banned of ['offers', 'review', 'aggregateRating', 'reviewRating']) {
        expect(keys.has(banned)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 1.1 — graph carries the stored attributes; absent inputs stay absent
// ---------------------------------------------------------------------------

describe('product graph attributes (1.1)', () => {
  it('carries brand, gtin13, the four additionalProperty entries, and dateModified', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(await FiProductPage({ params: Promise.resolve({ id: '42' }) }));

    const graph = findGraph('Product');
    expect(graph.brand).toEqual({ '@type': 'Brand', name: 'Panimo A' });
    expect(graph.gtin13).toBe('6410405248961');
    expect(graph.dateModified).toBe('2026-10-01T12:00:00.000Z');
    expect(graph.additionalProperty).toEqual([
      { '@type': 'PropertyValue', name: 'Pakkauskoko', value: '50 cl' },
      { '@type': 'PropertyValue', name: 'Alkoholipitoisuus', value: '4.7 %' },
      { '@type': 'PropertyValue', name: 'Pakkaustyyppi', value: 'Tölkki' },
      { '@type': 'PropertyValue', name: 'Palautusjärjestelmä', value: false },
    ]);
  });

  it('omits gtin13, the attribute entries, and dateModified when their inputs are absent', async () => {
    mockedGetServerProductDetail.mockResolvedValue(
      detailResponse({
        ean: null,
        alcoholByVolume: null,
        unitVolume: 'not-a-number',
        containerType: 'drum', // unknown storage key
        // Explicit undefined — a payload that predates the field.
        updatedAt: undefined,
      }),
    );

    render(await FiProductPage({ params: Promise.resolve({ id: '42' }) }));

    const graph = findGraph('Product');
    // Absent, never a placeholder.
    expect('gtin13' in graph).toBe(false);
    expect('dateModified' in graph).toBe(false);
    const entries = graph.additionalProperty as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      '@type': 'PropertyValue',
      name: 'Palautusjärjestelmä',
      value: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 1.1 — BreadcrumbList schema and the visible trail agree per locale
// ---------------------------------------------------------------------------

describe('breadcrumb pair — schema and visible trail (1.1)', () => {
  it('FI: schema Home / Tuotteet / product over the bare paths, visible links match', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(await FiProductPage({ params: Promise.resolve({ id: '42' }) }));

    expect(findGraph('BreadcrumbList').itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Etusivu', item: `${SITE_URL}/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Tuotteet',
        item: `${SITE_URL}/tuotteet`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Kotikalja 0.5 l',
        item: `${SITE_URL}/tuotteet/42`,
      },
    ]);

    expect(screen.getByText('Etusivu').closest('a')).toHaveAttribute('href', '/');
    expect(screen.getByText('Tuotteet').closest('a')).toHaveAttribute(
      'href',
      '/tuotteet',
    );
    // The current page's name renders as the non-link trail tail (the
    // name also appears in the h1 — match the aria-current span).
    const current = screen
      .getAllByText('Kotikalja 0.5 l')
      .find((el) => el.getAttribute('aria-current') === 'page');
    expect(current?.tagName).toBe('SPAN');
  });

  it('EN: schema Home / Products / product over the /en paths, visible links match', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    render(
      await ProductPage({
        params: Promise.resolve({ locale: 'en', id: '42' }),
      }),
    );

    expect(findGraph('BreadcrumbList').itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/en/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Products',
        item: `${SITE_URL}/en/products`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: 'Kotikalja 0.5 l',
        item: `${SITE_URL}/en/products/42`,
      },
    ]);

    expect(screen.getByText('Home').closest('a')).toHaveAttribute('href', '/en/');
    expect(screen.getByText('Products').closest('a')).toHaveAttribute(
      'href',
      '/en/products',
    );
  });
});

// ---------------------------------------------------------------------------
// 1.4 — enriched metadata; degraded fallback byte-identical
// ---------------------------------------------------------------------------

describe('enriched product metadata (1.4)', () => {
  it('FI title and description carry brand, category label, volume, and ABV', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', id: '42' }),
    });

    expect(meta.title).toContain('(Panimo A · Olut · 50 cl · 4.7 %)');
    expect(meta.title).toContain('hintatiedot');
    expect(meta.description).toContain('(Panimo A · Olut · 50 cl · 4.7 %)');
  });

  it('EN title and description carry the same tokens through the en catalog', async () => {
    mockedGetServerProductDetail.mockResolvedValue(detailResponse());

    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });

    expect(meta.title).toContain('(Panimo A · Beer · 50 cl · 4.7 %)');
    expect(meta.title).toContain('price information');
    expect(meta.description).toContain('(Panimo A · Beer · 50 cl · 4.7 %)');
  });

  it('degraded (unavailable-detail) fallback metadata stays byte-identical in both locales', async () => {
    mockedGetServerProductDetail.mockResolvedValue(null);

    const fi = await generateMetadata({
      params: Promise.resolve({ locale: 'fi', id: '42' }),
    });
    expect(fi.title).toBe('Tuotetta ei löytynyt');
    expect(fi.description).toBe(
      'Tuotteen hintatiedot ja kokonaiskustannuslaskuri.',
    );

    const en = await generateMetadata({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });
    expect(en.title).toBe('Product not found');
    expect(en.description).toBe(
      'Product price information and landed-cost calculator.',
    );
  });
});

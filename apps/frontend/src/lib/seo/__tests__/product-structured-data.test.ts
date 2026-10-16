/**
 * Product structured-data builder tests (seo-aeo-agent-surfaces 1.1).
 *
 * Pure unit tests over the lib/seo builders — the graph's contract is
 * pinned here at the data layer: the safe no-Offer variant, the
 * explicit-GTIN rule, the absence principle (absent input → absent
 * property, never a placeholder), dateModified from updated_at, and the
 * localized breadcrumb URL vocabulary.
 *
 * @module ProductStructuredDataTest
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildProductBreadcrumbJsonLd,
  buildProductJsonLd,
  isGtinShapedEan,
  productBreadcrumbPaths,
  productPageUrl,
} from '../product-structured-data';
import { SITE_URL } from '@/lib/api';
import type { ProductDetail } from '@/lib/types';

/** A full-attribute product — every optional input present. */
function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: 42,
    name: 'Kotikalja 0.5 l',
    manufacturer: 'Panimo A',
    brand: 'Panimo A',
    category: 'beer',
    alcoholByVolume: 0.047,
    unitVolume: '0.5',
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystemStatus: true,
    ean: '6410405248961',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  };
}

const FULL_LABELS = {
  volumeLabel: 'Pakkauskoko',
  abvLabel: 'Alkoholipitoisuus',
  containerLabel: 'Pakkaustyyppi',
  containerTypeLabel: 'Tölkki',
};

describe('buildProductJsonLd — the safe variant', () => {
  it('carries name, url, brand, gtin13, all four additionalProperty entries, and dateModified', () => {
    const graph = buildProductJsonLd({
      product: product(),
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@type']).toBe('Product');
    expect(graph.name).toBe('Kotikalja 0.5 l');
    expect(graph.url).toBe(`${SITE_URL}/tuotteet/42`);
    expect(graph.brand).toEqual({ '@type': 'Brand', name: 'Panimo A' });
    // Explicit-GTIN EAN → gtin13 verbatim.
    expect(graph.gtin13).toBe('6410405248961');
    expect(graph.dateModified).toBe('2026-10-01T12:00:00.000Z');

    // Stable order: volume, ABV, container, deposit — values rendered
    // through the shared formatters exactly as the page body renders them.
    expect(graph.additionalProperty).toEqual([
      { '@type': 'PropertyValue', name: 'Pakkauskoko', value: '50 cl' },
      { '@type': 'PropertyValue', name: 'Alkoholipitoisuus', value: '4.7 %' },
      { '@type': 'PropertyValue', name: 'Pakkaustyyppi', value: 'Tölkki' },
      { '@type': 'PropertyValue', name: 'Palautusjärjestelmä', value: true },
    ]);
  });

  it('localizes the deposit entry and the product URL per serving locale', () => {
    const graph = buildProductJsonLd({
      product: product({ depositSystemStatus: false }),
      id: '42',
      locale: 'en',
      labels: { ...FULL_LABELS, containerTypeLabel: 'Can' },
    });

    expect(graph.url).toBe(`${SITE_URL}/en/products/42`);
    expect(graph.additionalProperty?.at(-1)).toEqual({
      '@type': 'PropertyValue',
      name: 'Deposit system',
      value: false,
    });
  });

  it('never carries offer, rating, or review semantics — only the pinned key set', () => {
    // The fixture even has observed offers available one level up on the
    // payload — the builder only receives the product, so they cannot
    // leak into the graph.
    const graph = buildProductJsonLd({
      product: product(),
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    const keys = Object.keys(graph);
    expect([...keys].sort()).toEqual(
      [
        '@context',
        '@type',
        'name',
        'url',
        'brand',
        'gtin13',
        'additionalProperty',
        'dateModified',
      ].sort(),
    );
    const serialized = JSON.stringify(graph);
    for (const banned of [
      '"Offer"',
      '"AggregateOffer"',
      '"AggregateRating"',
      'offers',
      'review',
      'aggregateRating',
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });
});

describe('buildProductJsonLd — absent attributes stay absent', () => {
  it('omits gtin13 without an EAN and brand with an empty brand', () => {
    const graph = buildProductJsonLd({
      product: product({ ean: null, brand: '' }),
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    expect('gtin13' in graph).toBe(false);
    expect('brand' in graph).toBe(false);
  });

  it('omits dateModified when the payload predates the updatedAt field', () => {
    const { updatedAt: _omitted, ...withoutUpdatedAt } = product();
    const graph = buildProductJsonLd({
      product: withoutUpdatedAt as ProductDetail,
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    expect('dateModified' in graph).toBe(false);
  });

  it('omits dateModified for an unparseable timestamp — never a placeholder', () => {
    const graph = buildProductJsonLd({
      product: product({ updatedAt: 'not-a-timestamp' }),
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    expect('dateModified' in graph).toBe(false);
  });

  it('normalizes a valid offset timestamp to UTC ISO-8601 — same instant', () => {
    const graph = buildProductJsonLd({
      product: product({ updatedAt: '2026-10-01T15:00:00+03:00' }),
      id: '42',
      locale: 'fi',
      labels: FULL_LABELS,
    });

    expect(graph.dateModified).toBe('2026-10-01T12:00:00.000Z');
  });

  it('drops the volume, ABV, and container entries for absent or unparseable values', () => {
    const graph = buildProductJsonLd({
      product: product({
        unitVolume: 'not-a-number',
        alcoholByVolume: null,
        containerType: 'drum', // unknown storage key → no label
      }),
      id: '42',
      locale: 'fi',
      labels: { ...FULL_LABELS, containerTypeLabel: null },
    });

    // Only the deposit entry survives — the one always-present boolean.
    expect(graph.additionalProperty).toEqual([
      { '@type': 'PropertyValue', name: 'Palautusjärjestelmä', value: true },
    ]);
  });
});

describe('isGtinShapedEan — the explicit-GTIN rule', () => {
  it.each(['64104052', '641040524896', '6410405248961', '06410405248961'])(
    'accepts the GTIN-8/12/13/14 digit string %s',
    (ean) => {
      expect(isGtinShapedEan(ean)).toBe(true);
    },
  );

  it.each([
    null,
    '',
    'unknown',
    'n/a',
    '6410-4052-4896-1',
    ' 6410405248961',
    '64104052489613x',
    '12345',
  ])('rejects %s — no gtin13 without an explicit GTIN', (ean) => {
    expect(isGtinShapedEan(ean)).toBe(false);
  });
});

describe('breadcrumb paths and graph — the localized URL vocabulary', () => {
  it('resolves the FI bare paths', () => {
    expect(productBreadcrumbPaths('42', 'fi')).toEqual({
      home: '/',
      catalog: '/tuotteet',
      product: '/tuotteet/42',
    });
  });

  it('resolves the EN prefixed paths', () => {
    expect(productBreadcrumbPaths('42', 'en')).toEqual({
      home: '/en/',
      catalog: '/en/products',
      product: '/en/products/42',
    });
  });

  it('normalizes an unknown locale to the fi default (the routing fallback)', () => {
    expect(productBreadcrumbPaths('42', 'sv').catalog).toBe('/tuotteet');
  });

  it('builds the three-item trail with absolute URLs and passed-through labels', () => {
    const trail = buildProductBreadcrumbJsonLd({
      id: '42',
      locale: 'en',
      productName: 'Kotikalja 0.5 l',
      homeLabel: 'Home',
      catalogLabel: 'Products',
    });

    expect(trail['@type']).toBe('BreadcrumbList');
    expect(trail.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${SITE_URL}/en/`,
      },
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
  });

  it('exposes the product URL through the shared helper', () => {
    expect(productPageUrl('42', 'fi')).toBe(`${SITE_URL}/tuotteet/42`);
  });
});

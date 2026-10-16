/**
 * Per-product OG image composition tests (seo-aeo-agent-surfaces 1.7).
 *
 * The spec pins two things at the composition layer:
 *
 * 1. IDENTITY-ONLY — the image states the product name and brand (and
 *    the localized category label) and carries no price, availability,
 *    or observation-date content. Pinned here twice: structurally, via
 *    the `productOgIdentity` projection (a full detail payload — offers,
 *    prices, timestamps and all — collapses to the three identity
 *    fields, so volatile fields cannot reach the composition), and
 *    behaviorally, via a banned-content sweep of the rendered element
 *    tree.
 *
 * 2. DEGRADED-FIELD RENDER — a missing brand, an unknown category key,
 *    or a failed/null detail fetch each degrade the composition without
 *    failing the render: every case produces a valid element tree, and
 *    the all-null case renders the static site composition instead of
 *    inventing product copy.
 *
 * @module ProductOgImageTest
 */
// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  isProductCategoryKey,
  productOgIdentity,
  productOgImageElement,
  type ProductOgIdentity,
} from '../product-og-image';
import type { ProductDetailResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A full-identity product whose payload also carries volatile fields. */
function detail(overrides: Partial<{ name: string; brand: string }> = {}) {
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
      depositSystemStatus: true,
      ean: '6410405248961',
      ...overrides,
    },
    // Offers ride the payload with prices, stock states, and observation
    // timestamps — the exact fields the identity projection must strip.
    offers: [
      {
        id: 7,
        merchant: 'estonian_shop',
        merchantName: 'Estonian Shop',
        country: 'EE',
        currency: 'EUR',
        priceCents: 199,
        availability: 'in_stock',
        observedAt: '2026-10-10T12:00:00.000Z',
        sourceUrl: 'https://example.com/offer',
      },
    ],
    merchantWarnings: [],
  } as unknown as ProductDetailResponse;
}

const FULL_IDENTITY: ProductOgIdentity = {
  name: 'Kotikalja 0.5 l',
  brand: 'Panimo A',
  categoryLabel: 'Olut',
};

// ---------------------------------------------------------------------------
// Element-tree helpers — the composition is pure JSX, so the contract is
// asserted by walking the React elements (no renderer, no next/og).
// ---------------------------------------------------------------------------

interface ElementLike {
  type: unknown;
  props: { children?: unknown } & Record<string, unknown>;
}

/** Every text leaf in the element tree, in render order. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return out;
  }
  const element = node as ElementLike;
  if (
    element.props !== null &&
    typeof element.props === 'object' &&
    'children' in element.props
  ) {
    collectText(element.props.children, out);
  }
  return out;
}

function identityText(identity: ProductOgIdentity): string {
  // Text leaves joined without separators: the wordmark renders as the
  // sibling leaves "Rajahinta" + ".fi", and the assertions below match
  // the strings a reader (and satori) sees flowing together.
  return collectText(productOgImageElement(identity)).join('');
}

// ---------------------------------------------------------------------------
// productOgIdentity — the structural identity-only guarantee
// ---------------------------------------------------------------------------

describe('productOgIdentity — the identity projection', () => {
  it('projects a full detail payload down to exactly the identity triple', () => {
    // The fixture's offers carry priceCents, availability, and
    // observedAt — none can survive: the projection reads only
    // product.name and product.brand, and the category label arrives
    // pre-resolved by the adapter.
    expect(productOgIdentity(detail(), 'Olut')).toEqual({
      name: 'Kotikalja 0.5 l',
      brand: 'Panimo A',
      categoryLabel: 'Olut',
    });
  });

  it('emits exactly the three identity keys — no others exist to project', () => {
    expect(Object.keys(productOgIdentity(detail(), 'Olut')).sort()).toEqual([
      'brand',
      'categoryLabel',
      'name',
    ]);
  });

  it('degrades an empty brand to null (the JSON-LD builder parity rule)', () => {
    expect(productOgIdentity(detail({ brand: '' }), 'Olut').brand).toBeNull();
  });

  it('degrades a failed/null detail fetch to the all-null identity', () => {
    expect(productOgIdentity(null, null)).toEqual({
      name: null,
      brand: null,
      categoryLabel: null,
    });
  });
});

// ---------------------------------------------------------------------------
// productOgImageElement — identity-only composition
// ---------------------------------------------------------------------------

describe('productOgImageElement — identity-only composition', () => {
  it('renders the stored name, brand, and localized category label', () => {
    const text = identityText(FULL_IDENTITY);
    expect(text).toContain('Kotikalja 0.5 l');
    expect(text).toContain('Panimo A');
    expect(text).toContain('Olut');
  });

  it('carries no price, availability, or observation-date content', () => {
    const text = identityText(FULL_IDENTITY);
    // No currency symbol or money form …
    expect(text).not.toContain('€');
    expect(text).not.toMatch(/\d+[.,]\d{2}/);
    // … no ISO-8601 timestamp (the fixture's observedAt must not leak) …
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // … and no availability vocabulary in either locale.
    expect(text).not.toContain('in_stock');
    expect(text).not.toContain('Varastossa');
    expect(text).not.toContain('havainto');
  });

  it('keeps the brand and category on their joined detail line, not in the name', () => {
    // The name renders verbatim and alone on its line; the detail line
    // joins whatever identity fields survived degradation.
    const text = identityText(FULL_IDENTITY);
    expect(text).toContain('Kotikalja 0.5 l');
    expect(text).toContain('Panimo A · Olut');
  });

  it('carries the site wordmark so the card reads as first-party', () => {
    expect(identityText(FULL_IDENTITY)).toContain('Rajahinta.fi');
  });
});

// ---------------------------------------------------------------------------
// productOgImageElement — degraded-field render (never fails)
// ---------------------------------------------------------------------------

describe('productOgImageElement — degraded-field render', () => {
  it('drops only the brand when it is null — name and category still render', () => {
    const text = identityText({ ...FULL_IDENTITY, brand: null });
    expect(text).not.toContain('Panimo A');
    expect(text).toContain('Kotikalja 0.5 l');
    expect(text).toContain('Olut');
    // No empty shell: the join collapses, leaving no stray separator.
    expect(text).not.toContain('· Olut');
    expect(text).not.toContain('Panimo A ·');
  });

  it('drops only the category when its label is null (unknown key)', () => {
    const text = identityText({ ...FULL_IDENTITY, categoryLabel: null });
    expect(text).not.toContain('Olut');
    expect(text).toContain('Kotikalja 0.5 l');
    expect(text).toContain('Panimo A');
    expect(text).not.toContain('Panimo A ·');
  });

  it('renders a name-only image when both optional fields degrade', () => {
    const text = identityText({ name: 'Kotikalja 0.5 l', brand: null, categoryLabel: null });
    expect(text).toContain('Kotikalja 0.5 l');
    expect(text).not.toContain('·');
  });

  it('renders the static site composition for a failed fetch — valid image, no invented copy', () => {
    // The all-null identity (failed/null detail fetch) must still produce
    // a valid render: the site wordmark, and nothing product-specific.
    const text = identityText({ name: null, brand: null, categoryLabel: null });
    expect(text).toContain('Rajahinta.fi');
    expect(text).not.toContain('Kotikalja');
    expect(text).not.toContain('Panimo A');
    expect(text).not.toContain('Olut');
  });

  it('never throws for any degradation shape', () => {
    const shapes: ProductOgIdentity[] = [
      { name: null, brand: null, categoryLabel: null },
      { name: 'X', brand: null, categoryLabel: null },
      { name: null, brand: 'B', categoryLabel: 'C' },
      { name: 'X', brand: '', categoryLabel: '' },
    ];
    for (const shape of shapes) {
      expect(() => productOgImageElement(shape)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// isProductCategoryKey — the storage-key guard
// ---------------------------------------------------------------------------

describe('isProductCategoryKey', () => {
  it('accepts exactly the canonical PRODUCT_CATEGORIES values', () => {
    for (const key of [
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]) {
      expect(isProductCategoryKey(key)).toBe(true);
    }
  });

  it('rejects unknown or corrupt keys so they never reach the translator', () => {
    expect(isProductCategoryKey('cider')).toBe(false);
    expect(isProductCategoryKey('')).toBe(false);
    expect(isProductCategoryKey('BEER')).toBe(false);
  });
});

/**
 * FI per-product OG image route tests (seo-aeo-agent-surfaces 1.7).
 *
 * The route adapter's contract, pinned here the way the house pins route
 * modules (the real export called, the result asserted):
 *
 * - the static exports Next reads from the route module itself: the
 *   identity-descriptive Finnish `alt`, the 1200×630 size, and the PNG
 *   content type;
 * - the default image function RESOLVES to a PNG response for a valid
 *   product (the generated-image route works end to end, fetch →
 *   composition → ImageResponse);
 * - the degradation contract: a failed (null) detail fetch, an unknown
 *   category key, and a non-integer id each still resolve to a PNG
 *   response — the route never throws, never emits an error placeholder.
 *   The fetch-failure shape is `null`, the documented getServer*
 *   degradation contract — the helper never rejects, so null IS the
 *   backend-down case;
 * - the locale wiring: the pinned 'fi' reaches the ProductPage
 *   translations, so the category label is Finnish, and an unknown
 *   storage key never reaches the translator.
 *
 * The image render itself (satori/WASM) is deliberately not exercised:
 * ImageResponse only streams the pixels once the body is read, and the
 * composition's content contract is pinned in
 * `lib/seo/__tests__/product-og-image.test.ts`.
 *
 * @module FiProductOgImageRouteTest
 */
// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** The ProductPage label subset the adapter resolves through t(). */
const FI_LABELS: Record<string, string> = {
  'category.beer': 'Olut',
  'category.wine_still': 'Makuuviini',
  'category.wine_sparkling': 'Kuohuviini',
  'category.intermediate_products': 'Välituotteet (esim. vermutti)',
  'category.other_fermented': 'Siideri ja pitkäjuoma',
  'category.spirits': 'Väkevät alkoholijuomat',
};

const mocks = vi.hoisted(() => ({
  getServerProductDetail: vi.fn(),
  getTranslations: vi.fn(),
  translate: vi.fn((key: string) => FI_LABELS[key] ?? key),
}));

vi.mock('@/lib/server-api', () => ({
  getServerProductDetail: mocks.getServerProductDetail,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: mocks.getTranslations,
}));

import Image, { alt, size, contentType } from './opengraph-image';
import type { ProductDetailResponse } from '@/lib/types';

/** Minimal identity-bearing detail payload — offers included on purpose. */
function detail(category: string = 'beer'): ProductDetailResponse {
  return {
    product: {
      id: 42,
      name: 'Kotikalja 0.5 l',
      manufacturer: 'Panimo A',
      brand: 'Panimo A',
      category,
      alcoholByVolume: 0.047,
      unitVolume: '0.5',
      containerType: 'can',
      regulatoryClassification: 'beer',
      depositSystemStatus: true,
      ean: null,
    },
    offers: [],
  } as unknown as ProductDetailResponse;
}

beforeEach(() => {
  mocks.getServerProductDetail.mockReset();
  mocks.getTranslations.mockReset();
  mocks.translate.mockClear();
  mocks.getTranslations.mockResolvedValue(mocks.translate);
});

describe('FI product OG image route — static exports', () => {
  it('declares the identity-descriptive Finnish alt', () => {
    expect(alt).toBe('Rajahinta.fi — tuotteen nimi, merkki ja kategoria');
  });

  it('declares the 1200×630 PNG canvas', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });
});

describe('FI product OG image route — the generated-image route resolves', () => {
  it('fetches the product and returns a PNG response', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail());

    const res = await Image({ params: Promise.resolve({ id: '42' }) });

    expect(mocks.getServerProductDetail).toHaveBeenCalledWith(42);
    expect(mocks.getTranslations).toHaveBeenCalledWith({
      locale: 'fi',
      namespace: 'ProductPage',
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('resolves the Finnish category label through the ProductPage namespace', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail());

    await Image({ params: Promise.resolve({ id: '42' }) });

    expect(mocks.translate).toHaveBeenCalledWith('category.beer');
  });
});

describe('FI product OG image route — degradation never fails the render', () => {
  it('resolves to a valid PNG when the detail fetch degrades to null', async () => {
    // The documented getServer* contract: backend down, gates closed, or
    // unknown id all arrive as null — never a rejection.
    mocks.getServerProductDetail.mockResolvedValue(null);

    const res = await Image({ params: Promise.resolve({ id: '42' }) });

    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('guards the id before fetching — a non-integer id fetches nothing and still renders', async () => {
    const res = await Image({ params: Promise.resolve({ id: 'not-an-id' }) });

    expect(mocks.getServerProductDetail).not.toHaveBeenCalled();
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('drops an unknown category key from the label path — the raw key never reaches the translator', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail('cider'));

    const res = await Image({ params: Promise.resolve({ id: '42' }) });

    expect(mocks.translate).not.toHaveBeenCalledWith('category.cider');
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

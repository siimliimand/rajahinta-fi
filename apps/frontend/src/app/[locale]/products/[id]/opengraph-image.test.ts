/**
 * [locale] per-product OG image route tests (seo-aeo-agent-surfaces 1.7).
 *
 * The [locale]-tree twin of `tuotteet/[id]/opengraph-image.test.ts`; the
 * one contract this tree adds is the locale wiring: routing serves fi and
 * en only, so 'en' reaches the ProductPage translations as English while
 * anything else normalizes to 'fi' (the products-page precedent) — and
 * the static `alt` is English, because the [locale] segment only appears
 * on English URLs.
 *
 * Everything else mirrors the FI adapter's pinned contract: the static
 * exports, the fetch → composition → PNG resolution, and the degradation
 * cases (null detail, unknown category key, non-integer id) that must
 * always render a valid PNG response.
 *
 * The image render itself (satori/WASM) is deliberately not exercised:
 * ImageResponse only streams the pixels once the body is read, and the
 * composition's content contract is pinned in
 * `lib/seo/__tests__/product-og-image.test.ts`.
 *
 * @module LocaleProductOgImageRouteTest
 */
// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from 'vitest';

/** The ProductPage label subset the adapter resolves through t(). */
const LABELS: Record<string, Record<string, string>> = {
  fi: {
    'category.beer': 'Olut',
    'category.spirits': 'Väkevät alkoholijuomat',
  },
  en: {
    'category.beer': 'Beer',
    'category.spirits': 'Spirits',
  },
};

const mocks = vi.hoisted(() => ({
  getServerProductDetail: vi.fn(),
  getTranslations: vi.fn(),
  translate: vi.fn((key: string) => key),
}));

vi.mock('@/lib/server-api', () => ({
  getServerProductDetail: mocks.getServerProductDetail,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: mocks.getTranslations,
}));

import Image, { alt, size, contentType } from './opengraph-image';
import type { ProductDetailResponse } from '@/lib/types';

/** Minimal identity-bearing detail payload. */
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
  mocks.translate.mockReset();
  mocks.getTranslations.mockImplementation(async ({ locale }: { locale: string }) => {
    const table = LABELS[locale === 'en' ? 'en' : 'fi'] ?? {};
    mocks.translate.mockImplementation((key: string) => table[key] ?? key);
    return mocks.translate;
  });
});

describe('[locale] product OG image route — static exports', () => {
  it('declares the identity-descriptive English alt — the segment only serves English URLs', () => {
    expect(alt).toBe('Rajahinta.fi — product name, brand, and category');
  });

  it('declares the 1200×630 PNG canvas', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });
});

describe('[locale] product OG image route — the generated-image route resolves', () => {
  it('fetches the product and returns a PNG response for the English URL', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail());

    const res = await Image({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });

    expect(mocks.getServerProductDetail).toHaveBeenCalledWith(42);
    expect(mocks.getTranslations).toHaveBeenCalledWith({
      locale: 'en',
      namespace: 'ProductPage',
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('normalizes any non-en locale to fi — routing serves exactly the two locales', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail());

    await Image({
      params: Promise.resolve({ locale: 'de', id: '42' }),
    });

    expect(mocks.getTranslations).toHaveBeenCalledWith({
      locale: 'fi',
      namespace: 'ProductPage',
    });
  });

  it('resolves the localized category label through the ProductPage namespace', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail());

    await Image({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });

    expect(mocks.translate).toHaveBeenCalledWith('category.beer');
  });
});

describe('[locale] product OG image route — degradation never fails the render', () => {
  it('resolves to a valid PNG when the detail fetch degrades to null', async () => {
    // The documented getServer* contract: backend down, gates closed, or
    // unknown id all arrive as null — never a rejection.
    mocks.getServerProductDetail.mockResolvedValue(null);

    const res = await Image({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });

    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('guards the id before fetching — a non-integer id fetches nothing and still renders', async () => {
    const res = await Image({
      params: Promise.resolve({ locale: 'en', id: 'not-an-id' }),
    });

    expect(mocks.getServerProductDetail).not.toHaveBeenCalled();
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('drops an unknown category key from the label path — the raw key never reaches the translator', async () => {
    mocks.getServerProductDetail.mockResolvedValue(detail('cider'));

    const res = await Image({
      params: Promise.resolve({ locale: 'en', id: '42' }),
    });

    expect(mocks.translate).not.toHaveBeenCalledWith('category.cider');
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

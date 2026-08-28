/**
 * SearchController tests — q-parameter ranked search (task 5.1), sort
 * behavior, and the flag-gated merchantReliability embed (task 3.4,
 * change phase2-advanced-features).
 *
 * The `q` path delegates to ProductRepository.searchRanked (pg_trgm
 * similarity over name/brand/manufacturer, SQL-side filtering and
 * ranking); unit tests stub the repository with rank-ordered fixtures
 * and pin the controller contract — relevance order preserved, explicit
 * sort honored over the filtered set, pagination composing after
 * filtering, blank query passing through to the unfiltered listing.
 * The SQL semantics themselves (matching + similarity ranking) are
 * covered by the TEST_DATABASE_URL-gated product-search.db.test.ts.
 *
 * Follows the same pattern as sibling tests (direct instantiation with
 * manual mocks — no @nestjs/testing).
 *
 * @module SearchControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProductRepository } from '@rajahinta/data-platform';
import type { retailOffers } from '@rajahinta/data-platform';
import { FeatureFlagService } from '../../feature-flags';
import { MerchantReliabilityService } from '../../merchants';
import type { MerchantReliabilityMap } from '../../merchants';
import { SearchController } from '../search.controller';
import type {
  ProductSearchResult,
} from '../search.dto';

// ---------------------------------------------------------------------------
// Fixtures — products in reverse-alphabetical order
// ---------------------------------------------------------------------------

const PROD_Z = {
  id: 10,
  name: 'Öltermanni Olut',
  manufacturer: 'Panimo Oy',
  brand: 'Öltermanni',
  category: 'beer',
  alcoholByVolume: '0.047',
  unitVolume: '0.33',
  containerType: 'bottle',
  regulatoryClassification: 'beer',
  depositSystemStatus: false,
  ean: '0642000123456',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const PROD_A = {
  id: 20,
  name: 'A. Le Coq Premium',
  manufacturer: 'A. Le Coq',
  brand: 'A. Le Coq',
  category: 'beer',
  alcoholByVolume: '0.050',
  unitVolume: '0.50',
  containerType: 'bottle',
  regulatoryClassification: 'beer',
  depositSystemStatus: false,
  ean: '0642000654321',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

// Karhu fixtures (task 5.3) — one name match, one brand-only match. Both
// are returned by the ranked query for "karhu"; the order below is the
// relevance order the stubbed DB delivers (similarity DESC, id ASC).
const PROD_KARHU_NAME = {
  id: 30,
  name: 'Karhu III',
  manufacturer: 'Hartwall',
  brand: 'Karhu',
  category: 'beer',
  alcoholByVolume: '0.045',
  unitVolume: '0.33',
  containerType: 'can',
  regulatoryClassification: 'beer',
  depositSystemStatus: true,
  ean: '0641000111111',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const PROD_KARHU_BRAND = {
  id: 31,
  name: 'Tumma Lager',
  manufacturer: 'Hartwall',
  brand: 'Karhu',
  category: 'beer',
  alcoholByVolume: '0.045',
  unitVolume: '0.33',
  containerType: 'can',
  regulatoryClassification: 'beer',
  depositSystemStatus: true,
  ean: '0641000222222',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

/** Rank-ordered rows the stubbed ranked search returns for "karhu". */
const KARHU_RANKED = [PROD_KARHU_NAME, PROD_KARHU_BRAND];

// Make sure the return type matches `typeof productMaster.$inferSelect`
type MockProduct = typeof PROD_A;

// ---------------------------------------------------------------------------
// Fixtures — two current offers for PROD_A from different merchants
// ---------------------------------------------------------------------------

const OFFER_ALKO = {
  id: 101,
  merchant: 'alko',
  country: 'FI',
  productId: PROD_A.id,
  priceCents: 249,
  currency: 'EUR',
  originalPriceCents: null,
  originalCurrency: null,
  fxDatasetVersion: null,
  availability: 'in_stock',
  sourceUrl: 'https://example.com/alko/oltermanni',
  observedAt: new Date('2026-08-20T10:00:00Z'),
  reliabilityStatus: 'VERIFIED',
};

const OFFER_SYSTEMBOLAGET = {
  id: 102,
  merchant: 'systembolaget',
  country: 'SE',
  productId: PROD_A.id,
  // Ingestion-side conversion (design D2): canonical amount is EUR cents
  // with the SEK original and FX dataset version as provenance.
  priceCents: 199,
  currency: 'EUR',
  originalPriceCents: 2290,
  originalCurrency: 'SEK',
  fxDatasetVersion: 'fx-ecb-2026-08-19',
  availability: 'in_stock',
  sourceUrl: 'https://example.com/systembolaget/oltermanni',
  observedAt: new Date('2026-08-19T10:00:00Z'),
  reliabilityStatus: 'ESTIMATED',
};

// Offer mocks must satisfy the retail_offers row type, including the
// conversion-provenance columns added in migration 0015 (FIX-H).
type MockOffer = typeof retailOffers.$inferSelect;

/** ISO-string score DTO fixture mirroring the merchants module shape. */
const SCORE_ALKO = {
  merchant: 'alko',
  offerCount: 3,
  statusCounts: { VERIFIED: 2, ESTIMATED: 1, STALE: 0, UNAVAILABLE: 0 },
  statusShares: {
    VERIFIED: 2 / 3,
    ESTIMATED: 1 / 3,
    STALE: 0,
    UNAVAILABLE: 0,
  },
  strictestStatus: 'ESTIMATED',
  freshestObservedAt: '2026-08-20T10:00:00.000Z',
  governancePermissionStatus: 'GRANTED',
  computedAt: '2026-08-27T08:00:00.000Z',
} as const;

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockProductRepository(): Partial<ProductRepository> {
  return {
    findById: vi.fn(async (id: number): Promise<MockProduct | null> => {
      if (id === PROD_A.id) return PROD_A;
      if (id === PROD_Z.id) return PROD_Z;
      return null;
    }),
    findOffers: vi.fn(
      async (productId: number): Promise<MockOffer[]> => {
        if (productId === PROD_A.id) return [OFFER_ALKO, OFFER_SYSTEMBOLAGET];
        return [];
      },
    ),
    searchByName: vi.fn(
      async (
        query: string | null,
        _limit: number,
      ): Promise<MockProduct[]> => {
        if (query === null || query.trim().length === 0) {
          return [PROD_A, PROD_Z];
        }
        const q = query.trim().toLowerCase();
        return [PROD_A, PROD_Z].filter((p) =>
          p.name.toLowerCase().includes(q),
        );
      },
    ),
    // Ranked search (task 5.1) — returns the rows passed in, in the
    // given (rank) order, simulating what PostgreSQL delivers for the
    // pg_trgm query. Call arguments stay assertable via the mock.
    searchRanked: vi.fn(async (): Promise<MockProduct[]> => KARHU_RANKED),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchController — sort behavior', () => {
  let controller: SearchController;
  let mockRepo: Partial<ProductRepository>;
  let mockFlags: { isEnabled: ReturnType<typeof vi.fn> };
  let mockReliability: { getReliabilityScoreMap: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = createMockProductRepository();
    mockFlags = { isEnabled: vi.fn(() => false) };
    mockReliability = { getReliabilityScoreMap: vi.fn() };
    controller = new SearchController(
      mockRepo as unknown as ProductRepository,
      mockFlags as unknown as FeatureFlagService,
      mockReliability as unknown as MerchantReliabilityService,
    );
  });

  // -----------------------------------------------------------------------
  // ALPHABETICAL sort
  // -----------------------------------------------------------------------

  describe('sort=ALPHABETICAL', () => {
    it('returns results sorted by name (Finnish locale A→Ö)', async () => {
      // Products are requested in reverse-alphabetical order
      const result: ProductSearchResult = await controller.search(
        `${PROD_Z.id},${PROD_A.id}`,
        undefined,
        undefined,
        'ALPHABETICAL',
        undefined,
        undefined,
      );

      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe(PROD_A.name);
      expect(result.items[1].name).toBe(PROD_Z.name);
    });

    it('passes "ALPHABETICAL" through the sort validation', async () => {
      // Should not throw
      await expect(
        controller.search(`${PROD_A.id}`, undefined, undefined, 'ALPHABETICAL', undefined, undefined),
      ).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Non-ALPHABETICAL sort throws BadRequestException
  // -----------------------------------------------------------------------

  describe('unsupported sort orders', () => {
    const unsupportedOrders = [
      'LOWEST_LANDED_COST',
      'LOWEST_PER_LITRE',
      'LOWEST_PER_UNIT',
      'ALCOHOL_PERCENTAGE',
      'PRODUCT_CATEGORY',
    ] as const;

    for (const sortOrder of unsupportedOrders) {
      it(`rejects sort=${sortOrder} with BadRequestException`, async () => {
        try {
          await controller.search(
            `${PROD_A.id}`,
            undefined,
            undefined,
            sortOrder,
            undefined,
            undefined,
          );
          expect.unreachable('Expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse();
          expect(response).toMatchObject({
            statusCode: 400,
            message: `Sort order '${sortOrder}' is not supported in Phase 1. Only ALPHABETICAL is available.`,
          });
        }
      });
    }
  });

  // -----------------------------------------------------------------------
  // Default sort (no sort param)
  // -----------------------------------------------------------------------

  describe('default sort', () => {
    it('defaults to ALPHABETICAL when no sort param is provided', async () => {
      const result: ProductSearchResult = await controller.search(
        `${PROD_Z.id},${PROD_A.id}`,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      // Results should be sorted alphabetically
      expect(result.items).toHaveLength(2);
      expect(result.items[0].name).toBe(PROD_A.name);
      expect(result.items[1].name).toBe(PROD_Z.name);
    });
  });

  // -----------------------------------------------------------------------
  // Empty / no-IDs edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns empty result when no IDs match', async () => {
      const result: ProductSearchResult = await controller.search(
        '999,1000',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('falls back to listing all products when ids is empty string', async () => {
      const result: ProductSearchResult = await controller.search(
        '',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      // No ids and no query → the repository lists products (Phase 1
      // default listing; empty ids no longer short-circuits to empty).
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('falls back to listing all products when ids is undefined', async () => {
      const result: ProductSearchResult = await controller.search(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // q parameter — ranked search (task 5.1 / spec product-search)
  // -----------------------------------------------------------------------

  describe('q parameter — ranked search', () => {
    it('"karhu" returns the ranked matches in relevance order when no sort is requested', async () => {
      // The stubbed repository delivers the rank order PostgreSQL
      // produces for "karhu": the name match ahead of the brand-only
      // match.
      const result: ProductSearchResult = await controller.search(
        undefined,
        'karhu',
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.id)).toEqual([
        PROD_KARHU_NAME.id,
        PROD_KARHU_BRAND.id,
      ]);
      // Every hit is a Karhu product (name or brand) — matches only.
      expect(
        result.items.every(
          (i) => i.name === 'Karhu III' || i.brand === 'Karhu',
        ),
      ).toBe(true);
      // The ranked path bypasses the substring listing entirely.
      expect(mockRepo.searchByName).not.toHaveBeenCalled();
      expect(mockRepo.searchRanked).toHaveBeenCalledWith('karhu', 100);
    });

    it('issues the same query deterministically — identical order across repeated calls', async () => {
      const first = await controller.search(
        undefined, 'karhu', undefined, undefined, undefined, undefined,
      );
      const second = await controller.search(
        undefined, 'karhu', undefined, undefined, undefined, undefined,
      );

      expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id));
    });

    it('honors an explicit ALPHABETICAL sort over the filtered set', async () => {
      const result: ProductSearchResult = await controller.search(
        undefined,
        'karhu',
        undefined,
        'ALPHABETICAL',
        undefined,
        undefined,
      );

      // Filtered set re-sorted alphabetically ("Karhu III" < "Tumma
      // Lager"), regardless of the relevance order the DB returned.
      expect(result.items.map((i) => i.name)).toEqual([
        'Karhu III',
        'Tumma Lager',
      ]);
    });

    it('rejects an unsupported sort order even when q is provided', async () => {
      await expect(
        controller.search(
          undefined, 'karhu', undefined, 'LOWEST_LANDED_COST', undefined, undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('paginates the filtered set — filtering applies before pagination', async () => {
      // Page 1, one per page over the two karhu matches.
      const page1 = await controller.search(
        undefined, 'karhu', undefined, undefined, '1', '1',
      );
      expect(page1.items.map((i) => i.id)).toEqual([PROD_KARHU_NAME.id]);
      expect(page1.total).toBe(2);
      expect(page1.totalPages).toBe(2);

      // Page 2 — the second ranked match, not a re-query.
      const page2 = await controller.search(
        undefined, 'karhu', undefined, undefined, '2', '1',
      );
      expect(page2.items.map((i) => i.id)).toEqual([PROD_KARHU_BRAND.id]);

      // Composes with an explicit sort too: alphabetical order is
      // established over the filtered set, then sliced.
      const alphaPage2 = await controller.search(
        undefined, 'karhu', undefined, 'ALPHABETICAL', '2', '1',
      );
      expect(alphaPage2.items.map((i) => i.name)).toEqual(['Tumma Lager']);
    });

    it('ignores q when ids are provided — id lookup takes precedence', async () => {
      const result: ProductSearchResult = await controller.search(
        `${PROD_A.id}`,
        'karhu',
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(result.items.map((i) => i.id)).toEqual([PROD_A.id]);
      expect(mockRepo.searchRanked).not.toHaveBeenCalled();
    });

    it('blank and whitespace-only queries pass through to the unfiltered listing', async () => {
      for (const blank of ['', '   ']) {
        const result: ProductSearchResult = await controller.search(
          undefined,
          blank,
          undefined,
          undefined,
          undefined,
          undefined,
        );

        // Exactly the pre-q behaviour: repository listing, alphabetical.
        expect(mockRepo.searchByName).toHaveBeenCalledWith(blank, 100);
        expect(result.items.map((i) => i.name)).toEqual([
          PROD_A.name,
          PROD_Z.name,
        ]);
        expect(mockRepo.searchRanked).not.toHaveBeenCalled();
      }
    });

    it('absent q passes through to the unfiltered listing', async () => {
      const result: ProductSearchResult = await controller.search(
        undefined, undefined, undefined, undefined, undefined, undefined,
      );

      expect(mockRepo.searchByName).toHaveBeenCalledWith(null, 100);
      expect(result.total).toBe(2);
      expect(mockRepo.searchRanked).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Merchant reliability embed (task 3.4, change phase2-advanced-features)
// ---------------------------------------------------------------------------

describe('SearchController — merchant reliability embed', () => {
  let controller: SearchController;
  let mockRepo: Partial<ProductRepository>;
  let mockFlags: { isEnabled: ReturnType<typeof vi.fn> };
  let mockReliability: { getReliabilityScoreMap: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = createMockProductRepository();
    mockFlags = { isEnabled: vi.fn(() => false) };
    mockReliability = { getReliabilityScoreMap: vi.fn() };
    controller = new SearchController(
      mockRepo as unknown as ProductRepository,
      mockFlags as unknown as FeatureFlagService,
      mockReliability as unknown as MerchantReliabilityService,
    );
  });

  it('omits merchantReliability when the flag is off (byte-compatible)', async () => {
    mockFlags.isEnabled.mockReturnValue(false);

    const result = await controller.getProduct(PROD_A.id);

    // Field physically absent — not null, not undefined-with-key.
    expect('merchantReliability' in result).toBe(false);
    expect(result.merchantReliability).toBeUndefined();
    expect(mockFlags.isEnabled).toHaveBeenCalledWith('ADVANCED_FEATURES');
    // Score computation must not run on the un-gated path.
    expect(mockReliability.getReliabilityScoreMap).not.toHaveBeenCalled();
  });

  it('embeds scores for the offers\' merchants when the flag is on', async () => {
    mockFlags.isEnabled.mockReturnValue(true);
    const map: MerchantReliabilityMap = { alko: SCORE_ALKO };
    mockReliability.getReliabilityScoreMap.mockResolvedValue(map);

    const result = await controller.getProduct(PROD_A.id);

    expect(mockReliability.getReliabilityScoreMap).toHaveBeenCalledWith(
      new Set(['alko', 'systembolaget']),
    );
    expect(result.merchantReliability).toEqual(map);
    // Offers themselves are untouched — the embed never reorders them.
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0].merchant).toBe('alko');
  });

  it('omits the field when the product has no offers, even with the flag on', async () => {
    mockFlags.isEnabled.mockReturnValue(true);

    const result = await controller.getProduct(PROD_Z.id);

    expect('merchantReliability' in result).toBe(false);
    expect(mockReliability.getReliabilityScoreMap).not.toHaveBeenCalled();
  });

  it('omits the field when score computation fails — never fails the page', async () => {
    mockFlags.isEnabled.mockReturnValue(true);
    mockReliability.getReliabilityScoreMap.mockRejectedValue(
      new Error('governance port unwired'),
    );

    const result = await controller.getProduct(PROD_A.id);

    expect('merchantReliability' in result).toBe(false);
    expect(result.offers).toHaveLength(2);
  });
});
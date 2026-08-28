/**
 * SearchController sort behavior + reliability-embed tests.
 *
 * Tests that the controller correctly validates SortOrder, defaults to
 * ALPHABETICAL, sorts by name, and that the optional merchantReliability
 * embed on product detail is flag-gated (task 3.4, change
 * phase2-advanced-features): absent when the flag is off, present for the
 * offers' merchants when on, omitted (not thrown) on computation failure.
 *
 * Follows the same pattern as sibling tests (direct instantiation with
 * manual mocks — no @nestjs/testing).
 *
 * @module SearchControllerSortTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProductRepository } from '@rajahinta/data-platform';
import { FeatureFlagService } from '../../feature-flags';
import { MerchantReliabilityService } from '../../merchants';
import type { MerchantReliabilityMap } from '../../merchants';
import { SearchController } from '../search.controller';
import type {
  ProductSearchResult,
} from '../search.dto';

// ---------------------------------------------------------------------------
// Fixtures — two products in reverse-alphabetical order
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
  priceCents: 229,
  currency: 'SEK',
  availability: 'in_stock',
  sourceUrl: 'https://example.com/systembolaget/oltermanni',
  observedAt: new Date('2026-08-19T10:00:00Z'),
  reliabilityStatus: 'ESTIMATED',
};

type MockOffer = typeof OFFER_ALKO;

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
// Mock factory
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

    it('searches by name when q is provided', async () => {
      const result: ProductSearchResult = await controller.search(
        undefined,
        'Aino',
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockRepo.searchByName).toHaveBeenCalledWith('Aino', 100);
      expect(result.items.every((i) => i.name.toLowerCase().includes('aino'))).toBe(true);
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
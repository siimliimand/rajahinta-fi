/**
 * SearchController sort behavior tests.
 *
 * Tests that the controller correctly validates SortOrder, defaults to
 * ALPHABETICAL, and sorts results by name.
 *
 * Follows the same pattern as sibling tests (direct instantiation with
 * manual mocks — no @nestjs/testing).
 *
 * @module SearchControllerSortTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProductRepository } from '@rajahinta/data-platform';
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
// Mock factory
// ---------------------------------------------------------------------------

function createMockProductRepository(): Partial<ProductRepository> {
  return {
    findById: vi.fn(async (id: number): Promise<MockProduct | null> => {
      if (id === PROD_A.id) return PROD_A;
      if (id === PROD_Z.id) return PROD_Z;
      return null;
    }),
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

  beforeEach(() => {
    mockRepo = createMockProductRepository();
    controller = new SearchController(
      mockRepo as unknown as ProductRepository,
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
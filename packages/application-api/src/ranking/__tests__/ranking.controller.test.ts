/**
 * RankingController tests.
 *
 * Tests the methodology endpoint directly with a mocked RankingService,
 * following the same pattern as sibling tests (direct instantiation
 * with manual mocks, no @nestjs/testing).
 *
 * @module RankingControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RankingController } from '../ranking.controller';
import type { RankingService } from '@rajahinta/core-domain';
import type { SortOrder } from '@rajahinta/core-domain';
import type { RankingMethodology, SortOrderDescription } from '../ranking.controller';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

const ALL_SORT_ORDERS: SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
];

const SORT_DESCRIPTIONS: Record<SortOrder, string> = {
  LOWEST_LANDED_COST:
    'Products are sorted by total estimated landed cost from lowest to highest. ' +
    'The total includes foreign retail price, transport costs, alcohol excise duty, and container duty.',
  LOWEST_PER_LITRE:
    'Products are sorted by cost per litre from lowest to highest. ' +
    'The cost per litre is calculated as total landed cost divided by product volume.',
  LOWEST_PER_UNIT:
    'Products are sorted by cost per unit from lowest to highest. ' +
    'The cost per unit is calculated as total landed cost divided by quantity.',
  ALPHABETICAL:
    'Products are sorted alphabetically by name from A to Z using Finnish locale rules.',
  ALCOHOL_PERCENTAGE:
    'Products are sorted by alcohol by volume (ABV) from highest to lowest.',
  PRODUCT_CATEGORY:
    'Products are grouped by category and sorted alphabetically within each category. ' +
    'Categories are ordered alphabetically using Finnish locale rules.',
};

const SORT_LABELS: Record<string, string> = {
  LOWEST_LANDED_COST: 'Lowest landed cost',
  LOWEST_PER_LITRE: 'Lowest per litre',
  LOWEST_PER_UNIT: 'Lowest per unit',
  ALPHABETICAL: 'Alphabetical (A–Z)',
  ALCOHOL_PERCENTAGE: 'Alcohol percentage (highest first)',
  PRODUCT_CATEGORY: 'Category',
};

function createMockRankingService(): RankingService {
  return {
    rank: vi.fn(),
    describeSortOrder: vi.fn(
      (order: SortOrder): string => SORT_DESCRIPTIONS[order],
    ),
    getRankingMethodology: vi.fn(),
  } as unknown as RankingService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RankingController — GET /api/v1/ranking/methodology', () => {
  let controller: RankingController;
  let mockService: RankingService;

  beforeEach(() => {
    mockService = createMockRankingService();
    controller = new RankingController(mockService);
  });

  // ---------------------------------------------------------------------------
  // Response structure
  // ---------------------------------------------------------------------------

  describe('response structure', () => {
    it('returns a RankingMethodology object with all required top-level fields', () => {
      const result: RankingMethodology = controller.getMethodology();

      expect(result).toBeInstanceOf(Object);
      expect(result).toHaveProperty('introduction');
      expect(result).toHaveProperty('sortOrders');
      expect(result).toHaveProperty('tiebreaker');
      expect(result).toHaveProperty('deterministic');
    });

    it('returns a non-empty introduction string', () => {
      const result = controller.getMethodology();
      expect(result.introduction).toBeTruthy();
      expect(typeof result.introduction).toBe('string');
      expect(result.introduction.length).toBeGreaterThan(10);
    });

    it('returns a non-empty tiebreaker string', () => {
      const result = controller.getMethodology();
      expect(result.tiebreaker).toBeTruthy();
      expect(typeof result.tiebreaker).toBe('string');
      expect(result.tiebreaker.length).toBeGreaterThan(10);
    });

    it('reports deterministic as true', () => {
      const result = controller.getMethodology();
      expect(result.deterministic).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Sort-orders array
  // ---------------------------------------------------------------------------

  describe('sortOrders array', () => {
    it('contains exactly 6 sort orders', () => {
      const result = controller.getMethodology();
      expect(result.sortOrders).toBeInstanceOf(Array);
      expect(result.sortOrders).toHaveLength(6);
    });

    it('includes all expected sort-order names', () => {
      const result = controller.getMethodology();
      const names = result.sortOrders.map((o) => o.name);
      for (const expected of ALL_SORT_ORDERS) {
        expect(names).toContain(expected);
      }
    });

    it('is returned in the canonical order', () => {
      const result = controller.getMethodology();
      const names = result.sortOrders.map((o) => o.name);
      expect(names).toEqual([
        'LOWEST_LANDED_COST',
        'LOWEST_PER_LITRE',
        'LOWEST_PER_UNIT',
        'ALPHABETICAL',
        'ALCOHOL_PERCENTAGE',
        'PRODUCT_CATEGORY',
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Individual sort-order descriptions
  // ---------------------------------------------------------------------------

  describe('sort-order descriptions', () => {
    it('each sort order has name, label, and description as non-empty strings', () => {
      const result = controller.getMethodology();

      for (const order of result.sortOrders) {
        expect(typeof order.name).toBe('string');
        expect(order.name.length).toBeGreaterThan(0);

        expect(typeof order.label).toBe('string');
        expect(order.label.length).toBeGreaterThan(0);

        expect(typeof order.description).toBe('string');
        expect(order.description.length).toBeGreaterThan(0);
      }
    });

    it('each sort order has a matching label from SORT_LABEL', () => {
      const result = controller.getMethodology();

      for (const order of result.sortOrders) {
        expect(order.label).toBe(SORT_LABELS[order.name]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Service delegation
  // ---------------------------------------------------------------------------

  describe('service delegation', () => {
    it('calls describeSortOrder for every sort order', () => {
      controller.getMethodology();

      expect(mockService.describeSortOrder).toHaveBeenCalledTimes(6);
    });

    it('passes each sort-order name to describeSortOrder', () => {
      controller.getMethodology();

      for (const order of ALL_SORT_ORDERS) {
        expect(mockService.describeSortOrder).toHaveBeenCalledWith(order);
      }
    });

    it('uses the service-provided description verbatim', () => {
      const result = controller.getMethodology();

      for (const order of result.sortOrders) {
        expect(order.description).toBe(SORT_DESCRIPTIONS[order.name as SortOrder]);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Response shape matches RankingMethodology interface
  // ---------------------------------------------------------------------------

  describe('interface conformance', () => {
    it('sortOrders items match SortOrderDescription interface', () => {
      const result = controller.getMethodology();

      for (const order of result.sortOrders) {
        const desc: SortOrderDescription = order;
        expect(typeof desc.name).toBe('string');
        expect(typeof desc.label).toBe('string');
        expect(typeof desc.description).toBe('string');
      }
    });

    it('full response matches RankingMethodology interface', () => {
      const result: RankingMethodology = controller.getMethodology();

      // Structural type check at runtime
      expect(result.introduction).toBeDefined();
      expect(Array.isArray(result.sortOrders)).toBe(true);
      expect(result.tiebreaker).toBeDefined();
      expect(typeof result.deterministic).toBe('boolean');
    });

    it('every sortOrder.name is a valid SortOrder', () => {
      const result = controller.getMethodology();

      for (const order of result.sortOrders) {
        // Verify it is one of the known SortOrder values
        expect(ALL_SORT_ORDERS).toContain(order.name as SortOrder);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Neutrality statement
  // ---------------------------------------------------------------------------

  describe('neutrality statement', () => {
    it('introduction states that ranking is objective and non-commercial', () => {
      const result = controller.getMethodology();

      expect(result.introduction.toLowerCase()).toContain('objective');
      expect(result.introduction.toLowerCase()).toContain('non-commercial');
      // The text explains that these factors CANNOT affect ranking
      expect(result.introduction.toLowerCase()).toContain('no merchant');
    });
  });
});
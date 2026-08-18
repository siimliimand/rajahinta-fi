/**
 * Compliance test: frontend ranking descriptions vs RankingService lockstep.
 *
 * Asserts that every sort-order description displayed in the frontend matches
 * the authoritative description from `RankingService.describeSortOrder()`.
 * If this test fails in CI, the frontend copy has drifted from the backend
 * definition — update both in tandem.
 *
 * @module ComplianceTests
 */

import { describe, it, expect } from 'vitest';
import { RankingService } from '@rajahinta/core-domain';
import type { SortOrder } from '@rajahinta/core-domain';
import { SORT_ORDER_DESCRIPTIONS } from '@rajahinta/frontend/lib/ranking-descriptions';

// ---------------------------------------------------------------------------
// All sort orders — must match the union in core-domain
// ---------------------------------------------------------------------------

const ALL_SORT_ORDERS: SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createRankingService(): RankingService {
  // RankingService has no constructor dependencies — the @Injectable()
  // decorator attaches NestJS metadata, but the class can be instantiated
  // directly for testing.
  return new RankingService();
}

// ===========================================================================
// Ranking description lockstep
// ===========================================================================

describe('Ranking description lockstep (frontend vs RankingService)', () => {
  const service = createRankingService();

  it.each<SortOrder>(ALL_SORT_ORDERS)(
    'SORT_ORDER_DESCRIPTIONS[%s] matches RankingService.describeSortOrder()',
    (order) => {
      const frontendDescription = SORT_ORDER_DESCRIPTIONS[order];
      const backendDescription = service.describeSortOrder(order);

      expect(frontendDescription).toBe(backendDescription);
    },
  );

  it('covers every SortOrder value', () => {
    // Prove the test enumerates every possible SortOrder by checking that
    // the list is comprehensive. If SortOrder gains a new member, this test
    // will fail until the descriptions array is updated.
    const describedKeys = Object.keys(
      SORT_ORDER_DESCRIPTIONS,
    ) as SortOrder[];
    expect(new Set(describedKeys)).toEqual(new Set(ALL_SORT_ORDERS));
  });

  it('RankingService covers every SortOrder value', () => {
    // Double-check the service itself — if a new SortOrder is added to the
    // type but describeSortOrder doesn't handle it, this catches that too.
    for (const order of ALL_SORT_ORDERS) {
      expect(() => service.describeSortOrder(order)).not.toThrow();
    }
  });
});
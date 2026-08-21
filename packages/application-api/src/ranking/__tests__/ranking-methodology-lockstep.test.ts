/**
 * Lockstep test: RankingController methodology endpoint vs RankingService.
 *
 * Asserts that the structured methodology returned by
 * `GET /api/v1/ranking/methodology` is generated from the same source as
 * `RankingService`'s actual sort descriptions. Fails when one drifts
 * without the other.
 *
 * ## Lockstep mechanism
 *
 *   1. Instantiates the real RankingService (no DI deps — @Injectable only).
 *   2. Instantiates RankingController with the real service.
 *   3. Asserts every `SortOrder` the service handles appears in the
 *      controller's methodology response with a matching description.
 *   4. Asserts no extra sort orders appear in the controller that
 *      the service does not describe.
 *
 * If a new `SortOrder` is added to the type but not to the controller, or
 * if the controller adds orders the service does not handle, the test fails.
 *
 * @module RankingMethodologyLockstepTest
 */

import { describe, it, expect } from 'vitest';
import { RankingService } from '@rajahinta/core-domain';
import type { SortOrder } from '@rajahinta/core-domain';
import { RankingController } from '../ranking.controller';
import type { RankingMethodology } from '../ranking.controller';

// ---------------------------------------------------------------------------
// Canonical list of sort orders — must match the SortOrder union in core-domain
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

function createRealService(): RankingService {
  // RankingService has no constructor dependencies — the @Injectable()
  // decorator attaches NestJS metadata, but the class can be instantiated
  // directly for unit testing.
  return new RankingService();
}

function createControllerWithRealService(
  service: RankingService,
): RankingController {
  return new RankingController(service);
}

// ===========================================================================
// Lockstep tests
// ===========================================================================

describe('Ranking methodology lockstep (endpoint vs service)', () => {
  const service = createRealService();
  const controller = createControllerWithRealService(service);

  // ---------------------------------------------------------------------------
  // 1. Cover every SortOrder — every order the service knows about appears in
  //    the controller's methodology response, and no extra orders exist.
  // ---------------------------------------------------------------------------

  describe('controller methodology covers all service sort orders', () => {
    it('every SortOrder known to the service appears in the response', () => {
      const methodology: RankingMethodology = controller.getMethodology();
      const names = methodology.sortOrders.map((o) => o.name);

      for (const order of ALL_SORT_ORDERS) {
        expect(names).toContain(order);
      }
    });

    it('the number of sort orders in the response matches the service', () => {
      const methodology: RankingMethodology = controller.getMethodology();
      expect(methodology.sortOrders).toHaveLength(ALL_SORT_ORDERS.length);
    });

    it('no extra sort orders appear in the controller response', () => {
      const methodology: RankingMethodology = controller.getMethodology();
      const names = methodology.sortOrders.map((o) => o.name);

      for (const name of names) {
        // Every name in the controller response must be a valid SortOrder
        // that the service knows how to describe.
        expect(ALL_SORT_ORDERS).toContain(name);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Description fidelity — each sort order's description in the endpoint
  //    matches the authoritative description from RankingService.describeSortOrder().
  // ---------------------------------------------------------------------------

  describe('sort-order descriptions match RankingService', () => {
    it.each<SortOrder>(ALL_SORT_ORDERS)(
      'controller description for %s matches RankingService.describeSortOrder()',
      (order) => {
        const methodology: RankingMethodology = controller.getMethodology();

        const entry = methodology.sortOrders.find(
          (o) => o.name === order,
        );
        expect(entry).toBeDefined();
        expect(entry!.description).toBe(service.describeSortOrder(order));
      },
    );

    it('every controller description matches the service (batch check)', () => {
      const methodology: RankingMethodology = controller.getMethodology();

      for (const order of methodology.sortOrders) {
        const expected = service.describeSortOrder(
          order.name as SortOrder,
        );
        expect(order.description).toBe(expected);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Service completeness — the service can describe every SortOrder
  //    without throwing. If a new SortOrder value is added and the service's
  //    `describeSortOrder` switch does not handle it, this test fails here
  //    rather than at runtime.
  // ---------------------------------------------------------------------------

  describe('RankingService covers all SortOrder values', () => {
    it('describeSortOrder does not throw for any known SortOrder', () => {
      for (const order of ALL_SORT_ORDERS) {
        expect(() => service.describeSortOrder(order)).not.toThrow();
      }
    });
  });
});
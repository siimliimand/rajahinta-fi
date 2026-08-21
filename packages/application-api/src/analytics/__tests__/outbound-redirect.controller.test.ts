/**
 * OutboundRedirectController tests.
 *
 * Tests the offer redirect endpoint with mocked ProductRepository and
 * ClickAnalyticsService, following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation with manual mocks).
 *
 * @module OutboundRedirectControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { OutboundRedirectController } from '../outbound-redirect.controller';
import { ClickAnalyticsService } from '../click-analytics.service';
import type { ClickStats } from '../click-analytics.service';
import type { ProductRepository } from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a retail offer row returned by findRetailOfferById. */
interface MockRetailOffer {
  readonly id: number;
  readonly merchant: string;
  readonly sourceUrl: string | null;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockProductRepo(): ProductRepository {
  const offers = new Map<number, MockRetailOffer>();

  // Seed a single known offer for happy-path tests
  offers.set(1, {
    id: 1,
    merchant: 'alko',
    sourceUrl: 'https://www.alko.fi/tuotteet/olut',
  });
  // Offer with no source URL
  offers.set(2, {
    id: 2,
    merchant: 'systembolaget',
    sourceUrl: null,
  });

  return {
    findById: vi.fn(),
    findOffers: vi.fn(),
    findRetailOfferById: vi.fn(
      (id: number): Promise<MockRetailOffer | null> => {
        return Promise.resolve(offers.get(id) ?? null);
      },
    ),
    create: vi.fn(),
    upsertByEan: vi.fn(),
  } as unknown as ProductRepository;
}

function createMockClickService(): ClickAnalyticsService {
  const clicks = new Map<string, Map<string, number>>();

  return {
    recordClick: vi.fn((merchantId: string, url: string): void => {
      let merchantClicks = clicks.get(merchantId);
      if (!merchantClicks) {
        merchantClicks = new Map<string, number>();
        clicks.set(merchantId, merchantClicks);
      }
      const current = merchantClicks.get(url) ?? 0;
      merchantClicks.set(url, current + 1);
    }),
    getClickCounts: vi.fn((): Record<string, Record<string, number>> => {
      const result: Record<string, Record<string, number>> = {};
      for (const [merchantId, merchantClicks] of clicks) {
        const counts: Record<string, number> = {};
        for (const [url, count] of merchantClicks) {
          counts[url] = count;
        }
        result[merchantId] = counts;
      }
      return result;
    }),
    getClickStats: vi.fn((): Record<string, ClickStats> => {
      const result: Record<string, ClickStats> = {};
      for (const [merchantId, merchantClicks] of clicks) {
        const perUrl: Record<string, number> = {};
        let totalClicks = 0;
        for (const [url, count] of merchantClicks) {
          perUrl[url] = count;
          totalClicks += count;
        }
        result[merchantId] = {
          totalClicks,
          uniqueUrls: merchantClicks.size,
          perUrl,
          purchaseCount: 0,
          commissionTotalCents: 0,
          affiliateCommissionCents: 0,
          transactionCount: 0,
        };
      }
      return result;
    }),
    reset: vi.fn((): void => {
      clicks.clear();
    }),
  } as unknown as ClickAnalyticsService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboundRedirectController — GET /api/v1/outbound/:offerId', () => {
  let controller: OutboundRedirectController;
  let mockProductRepo: ProductRepository;
  let mockClickService: ClickAnalyticsService;

  beforeEach(() => {
    mockProductRepo = createMockProductRepo();
    mockClickService = createMockClickService();
    controller = new OutboundRedirectController(mockProductRepo, mockClickService);
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('known offer with source URL', () => {
    it('returns 302 redirect to the source URL', async () => {
      const result = await controller.redirect(1);

      expect(result).toEqual({
        url: 'https://www.alko.fi/tuotteet/olut',
        statusCode: 302,
      });
    });

    it('records a click via ClickAnalyticsService', async () => {
      await controller.redirect(1);

      expect(mockClickService.recordClick).toHaveBeenCalledWith(
        'alko',
        'https://www.alko.fi/tuotteet/olut',
      );
    });

    it('increments click count on repeated redirects', async () => {
      await controller.redirect(1);
      await controller.redirect(1);
      await controller.redirect(1);

      expect(mockClickService.recordClick).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown offer
  // ---------------------------------------------------------------------------

  describe('unknown offer', () => {
    it('throws NotFoundException when offer does not exist', async () => {
      await expect(controller.redirect(999)).rejects.toThrow(NotFoundException);
    });

    it('does not record a click for unknown offers', async () => {
      try {
        await controller.redirect(999);
      } catch {
        // expected
      }
      expect(mockClickService.recordClick).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Offer without source URL
  // ---------------------------------------------------------------------------

  describe('offer missing source URL', () => {
    it('throws NotFoundException when offer has no sourceUrl', async () => {
      await expect(controller.redirect(2)).rejects.toThrow(NotFoundException);
    });

    it('does not record a click for offers without sourceUrl', async () => {
      try {
        await controller.redirect(2);
      } catch {
        // expected
      }
      expect(mockClickService.recordClick).not.toHaveBeenCalled();
    });
  });
});
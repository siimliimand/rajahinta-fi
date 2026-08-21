/**
 * AnalyticsController tests.
 *
 * Tests the click-recording endpoint directly with a mocked
 * ClickAnalyticsService, following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation with manual mocks).
 *
 * @module AnalyticsControllerTest
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AnalyticsController } from '../analytics.controller';
import { ClickAnalyticsService } from '../click-analytics.service';
import type { ClickStats } from '../click-analytics.service';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

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

describe('AnalyticsController — POST /api/v1/analytics/click', () => {
  let controller: AnalyticsController;
  let mockService: ClickAnalyticsService;

  beforeEach(() => {
    mockService = createMockClickService();
    controller = new AnalyticsController(mockService);
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('valid payload', () => {
    it('records a click and returns success with count 1', () => {
      const result = controller.recordClick({
        merchantId: 'alko',
        url: 'https://www.alko.fi/tuotteet/olut',
      });

      expect(result).toEqual({ success: true, count: 1 });
      expect(mockService.recordClick).toHaveBeenCalledWith(
        'alko',
        'https://www.alko.fi/tuotteet/olut',
      );
    });

    it('increments the count on repeated clicks for the same merchant+url', () => {
      const payload = {
        merchantId: 'alko',
        url: 'https://www.alko.fi/tuotteet/olut',
      };

      // First click
      const result1 = controller.recordClick(payload);
      expect(result1).toEqual({ success: true, count: 1 });

      // Second click
      const result2 = controller.recordClick(payload);
      expect(result2).toEqual({ success: true, count: 2 });

      // Third click
      const result3 = controller.recordClick(payload);
      expect(result3).toEqual({ success: true, count: 3 });

      expect(mockService.recordClick).toHaveBeenCalledTimes(3);
    });

    it('maintains separate counts for different merchants', () => {
      const url = 'https://www.alko.fi/tuotteet/olut';

      controller.recordClick({ merchantId: 'alko', url });
      controller.recordClick({ merchantId: 'alko', url });
      controller.recordClick({ merchantId: 'citymarket', url });

      const alkoCount = controller.recordClick({
        merchantId: 'alko',
        url,
      });
      expect(alkoCount).toEqual({ success: true, count: 3 });

      const citymarketCount = controller.recordClick({
        merchantId: 'citymarket',
        url,
      });
      expect(citymarketCount).toEqual({ success: true, count: 2 });
    });
  });

  // ---------------------------------------------------------------------------
  // Forbidden fields
  // ---------------------------------------------------------------------------

  describe('forbidden fields', () => {
    const validBase = {
      merchantId: 'alko',
      url: 'https://www.alko.fi/tuotteet/olut',
    };

    it.each(['commission', 'affiliate', 'purchase', 'transactionId', 'orderId'])(
      'rejects payload containing "%s" with BadRequestException',
      (forbiddenField) => {
        const payload = { ...validBase, [forbiddenField]: 'some-value' };

        try {
          controller.recordClick(payload);
          expect.unreachable('Expected BadRequestException');
        } catch (err) {
          expect(err).toBeInstanceOf(BadRequestException);
          const response = (err as BadRequestException).getResponse();
          expect(response).toMatchObject({
            statusCode: 400,
            message: `Field "${forbiddenField}" is not allowed in click analytics payload`,
            error: 'ForbiddenField',
          });
        }
      },
    );

    it('rejects payload with multiple forbidden fields (first wins)', () => {
      const payload = {
        ...validBase,
        commission: '0.05',
        affiliate: 'ref-123',
      };

      try {
        controller.recordClick(payload);
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({
          statusCode: 400,
          error: 'ForbiddenField',
        });
        // Should report the first forbidden field encountered
        expect((response as Record<string, unknown>).message).toContain('commission');
      }
    });

    it('does not record click when payload is rejected', () => {
      try {
        controller.recordClick({ ...validBase, commission: '0.10' });
        expect.unreachable('Expected BadRequestException');
      } catch {
        // expected
      }
      expect(mockService.recordClick).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Missing required fields
  // ---------------------------------------------------------------------------

  describe('missing required fields', () => {
    it('rejects missing merchantId with BadRequestException', () => {
      try {
        controller.recordClick({
          url: 'https://www.alko.fi/tuotteet/olut',
        } as Record<string, unknown>);
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({
          statusCode: 400,
          message: '"merchantId" is required and must be a non-empty string',
          error: 'ValidationError',
        });
      }
    });

    it('rejects empty merchantId with BadRequestException', () => {
      try {
        controller.recordClick({
          merchantId: '',
          url: 'https://www.alko.fi/tuotteet/olut',
        });
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({
          statusCode: 400,
          error: 'ValidationError',
        });
      }
    });

    it('rejects non-string merchantId with BadRequestException', () => {
      try {
        controller.recordClick({
          merchantId: 42,
          url: 'https://www.alko.fi/tuotteet/olut',
        } as unknown as Record<string, unknown>);
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          error: 'ValidationError',
        });
      }
    });

    it('rejects missing url with BadRequestException', () => {
      try {
        controller.recordClick({
          merchantId: 'alko',
        } as Record<string, unknown>);
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        const response = (err as BadRequestException).getResponse();
        expect(response).toMatchObject({
          statusCode: 400,
          message: '"url" is required and must be a non-empty string',
          error: 'ValidationError',
        });
      }
    });

    it('rejects empty url with BadRequestException', () => {
      try {
        controller.recordClick({
          merchantId: 'alko',
          url: '',
        });
        expect.unreachable('Expected BadRequestException');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          error: 'ValidationError',
        });
      }
    });

    it('does not record click when required fields are missing', () => {
      try {
        controller.recordClick({} as Record<string, unknown>);
        expect.unreachable('Expected BadRequestException');
      } catch {
        // expected
      }
      expect(mockService.recordClick).not.toHaveBeenCalled();
    });
  });
});
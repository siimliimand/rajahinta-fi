/**
 * AnalyticsController tests.
 *
 * Tests the click-recording endpoint against a real RedisClickAnalyticsService
 * over an in-memory Redis double (same fake shape as the audit suite), with
 * spies on the service surface, following the same pattern as sibling tests
 * (no @nestjs/testing — direct instantiation).
 *
 * @module AnalyticsControllerTest
 */

import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import { AnalyticsController } from '../analytics.controller';
import { RedisClickAnalyticsService } from '../../audit/redis-click-analytics.service';

// ---------------------------------------------------------------------------
// In-memory Redis double — implements the small command surface the click
// services use (multi/hincrby/hset/exec, hgetall, scan).
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();

  const hash = (key: string): Map<string, string> => {
    let entry = hashes.get(key);
    if (!entry) {
      entry = new Map();
      hashes.set(key, entry);
    }
    return entry;
  };

  return {
    hgetall: async (key: string): Promise<Record<string, string>> =>
      Object.fromEntries(hash(key)),
    scan: async (
      _cursor: string,
      _mode: 'MATCH',
      pattern: string,
    ): Promise<[string, string[]]> => {
      const prefix = pattern.slice(0, -1); // strip trailing '*'
      return ['0', [...hashes.keys()].filter((k) => k.startsWith(prefix))];
    },
    multi() {
      const ops: Array<() => void> = [];
      const chain = {
        hincrby(key: string, field: string, inc: number) {
          ops.push(() => {
            const entry = hash(key);
            entry.set(field, String(Number(entry.get(field) ?? 0) + inc));
          });
          return chain;
        },
        hset(key: string, field: string, value: string) {
          ops.push(() => hash(key).set(field, value));
          return chain;
        },
        async exec() {
          for (const op of ops) op();
          return [];
        },
      };
      return chain;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsController — POST /api/v1/analytics/click', () => {
  let controller: AnalyticsController;
  let service: RedisClickAnalyticsService;
  let recordClickSpy: MockInstance<
    (merchantId: string, url: string) => Promise<void>
  >;

  beforeEach(() => {
    service = new RedisClickAnalyticsService(
      createFakeRedis() as unknown as Redis,
    );
    recordClickSpy = vi.spyOn(service, 'recordClick');
    controller = new AnalyticsController(service);
  });

  // ---------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------

  describe('valid payload', () => {
    it('records a click and returns success with count 1', async () => {
      const result = await controller.recordClick({
        merchantId: 'alko',
        url: 'https://www.alko.fi/tuotteet/olut',
      });

      expect(result).toEqual({ success: true, count: 1 });
      expect(recordClickSpy).toHaveBeenCalledWith(
        'alko',
        'https://www.alko.fi/tuotteet/olut',
      );
    });

    it('increments the count on repeated clicks for the same merchant+url', async () => {
      const payload = {
        merchantId: 'alko',
        url: 'https://www.alko.fi/tuotteet/olut',
      };

      expect(await controller.recordClick(payload)).toEqual({
        success: true,
        count: 1,
      });
      expect(await controller.recordClick(payload)).toEqual({
        success: true,
        count: 2,
      });
      expect(await controller.recordClick(payload)).toEqual({
        success: true,
        count: 3,
      });

      expect(recordClickSpy).toHaveBeenCalledTimes(3);
    });

    it('maintains separate counts for different merchants', async () => {
      const url = 'https://www.alko.fi/tuotteet/olut';

      await controller.recordClick({ merchantId: 'alko', url });
      await controller.recordClick({ merchantId: 'alko', url });
      await controller.recordClick({ merchantId: 'citymarket', url });

      const alkoCount = await controller.recordClick({
        merchantId: 'alko',
        url,
      });
      expect(alkoCount).toEqual({ success: true, count: 3 });

      const citymarketCount = await controller.recordClick({
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
      async (forbiddenField) => {
        const payload = { ...validBase, [forbiddenField]: 'some-value' };

        try {
          await controller.recordClick(payload);
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

    it('rejects payload with multiple forbidden fields (first wins)', async () => {
      const payload = {
        ...validBase,
        commission: '0.05',
        affiliate: 'ref-123',
      };

      try {
        await controller.recordClick(payload);
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

    it('does not record click when payload is rejected', async () => {
      try {
        await controller.recordClick({ ...validBase, commission: '0.10' });
        expect.unreachable('Expected BadRequestException');
      } catch {
        // expected
      }
      expect(recordClickSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Missing required fields
  // ---------------------------------------------------------------------------

  describe('missing required fields', () => {
    it('rejects missing merchantId with BadRequestException', async () => {
      try {
        await controller.recordClick({
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

    it('rejects empty merchantId with BadRequestException', async () => {
      try {
        await controller.recordClick({
          merchantId: '',
          url: 'https://www.alko.fi/tuotteet/olut',
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

    it('rejects non-string merchantId with BadRequestException', async () => {
      try {
        await controller.recordClick({
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

    it('rejects missing url with BadRequestException', async () => {
      try {
        await controller.recordClick({
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

    it('rejects empty url with BadRequestException', async () => {
      try {
        await controller.recordClick({
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

    it('does not record click when required fields are missing', async () => {
      try {
        await controller.recordClick({} as Record<string, unknown>);
        expect.unreachable('Expected BadRequestException');
      } catch {
        // expected
      }
      expect(recordClickSpy).not.toHaveBeenCalled();
    });
  });
});

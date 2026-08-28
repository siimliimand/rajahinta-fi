/**
 * OutboundRedirectController tests.
 *
 * Tests the offer redirect endpoint with a mocked ProductRepository and a
 * real RedisClickAnalyticsService over an in-memory Redis double, following
 * the same pattern as sibling tests (no @nestjs/testing — direct
 * instantiation with manual doubles).
 *
 * The redirect must NOT await click recording (fire-and-forget hot path), so
 * the click-recording assertions give the micro-task queue a chance to drain
 * before asserting.
 *
 * @module OutboundRedirectControllerTest
 */

import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type Redis from 'ioredis';
import { OutboundRedirectController } from '../outbound-redirect.controller';
import { RedisClickAnalyticsService } from '../../audit/redis-click-analytics.service';
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

/** Let pending micro-tasks (the fire-and-forget recordClick) settle. */
const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutboundRedirectController — GET /api/v1/outbound/:offerId', () => {
  let controller: OutboundRedirectController;
  let mockProductRepo: ProductRepository;
  let clickService: RedisClickAnalyticsService;
  let recordClickSpy: MockInstance<
    (merchantId: string, url: string) => Promise<void>
  >;

  beforeEach(() => {
    mockProductRepo = createMockProductRepo();
    clickService = new RedisClickAnalyticsService(
      createFakeRedis() as unknown as Redis,
    );
    recordClickSpy = vi.spyOn(clickService, 'recordClick');
    controller = new OutboundRedirectController(mockProductRepo, clickService);
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

    it('records a click via the durable click service (fire-and-forget)', async () => {
      await controller.redirect(1);
      await flushMicrotasks();

      expect(recordClickSpy).toHaveBeenCalledWith(
        'alko',
        'https://www.alko.fi/tuotteet/olut',
      );
    });

    it('counts repeated redirects', async () => {
      await controller.redirect(1);
      await controller.redirect(1);
      await controller.redirect(1);
      await flushMicrotasks();

      expect(recordClickSpy).toHaveBeenCalledTimes(3);
      const counts = await clickService.getClickCounts();
      expect(counts.alko['https://www.alko.fi/tuotteet/olut']).toBe(3);
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
      await flushMicrotasks();
      expect(recordClickSpy).not.toHaveBeenCalled();
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
      await flushMicrotasks();
      expect(recordClickSpy).not.toHaveBeenCalled();
    });
  });
});

/**
 * Tests for RateReviewSchedulerService.
 *
 * High-liability coverage:
 *   - Rate-review entry creation (the "never auto-publish" invariant)
 *   - Error handling in createRateUpdateTask (no-op guard)
 *   - Scheduler lifecycle (scheduleNextReview, stopReviews)
 *   - Config-driven discovery toggle (discoveryDisabled)
 *
 * @module RateReviewSchedulerServiceTests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateReviewSchedulerService, DEFAULT_RATE_REVIEW_CONFIG } from '../services/rate-review-scheduler.service';
import type { IRateReviewRepository } from '../interfaces/rate-review-repository.port';
import type { RateReviewEntry } from '../interfaces/rate-review.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeRepository(
  overrides?: Partial<IRateReviewRepository>,
): IRateReviewRepository {
  const store = new Map<string, RateReviewEntry>();

  return {
    create: vi.fn().mockImplementation(async (entry: RateReviewEntry) => {
      store.set(entry.id, entry);
    }),
    findById: vi.fn().mockImplementation(async (id: string) => {
      return store.get(id) ?? null;
    }),
    findByStatus: vi.fn().mockImplementation(async (status) => {
      return Array.from(store.values())
        .filter((e) => e.status === status)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }),
    updateStatus: vi.fn().mockImplementation(
      async (id, status, resolution, resolvedAt) => {
        const existing = store.get(id);
        if (existing) {
          store.set(id, { ...existing, status, resolution, resolvedAt });
        }
      },
    ),
    ...overrides,
  };
}

function createService(overrides?: {
  repository?: Partial<IRateReviewRepository>;
  discoveryDisabled?: boolean;
}): RateReviewSchedulerService {
  const repo = createFakeRepository(overrides?.repository);
  const config = {
    ...DEFAULT_RATE_REVIEW_CONFIG,
    discoveryDisabled: overrides?.discoveryDisabled ?? false,
  };
  return new RateReviewSchedulerService(repo, config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RateReviewSchedulerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // checkForRateChanges
  // ---------------------------------------------------------------------------

  describe('checkForRateChanges', () => {
    it('returns a result with checkedAt timestamp', async () => {
      const service = createService();
      const result = await service.checkForRateChanges();

      expect(result).toHaveProperty('checkedAt');
      expect(typeof result.checkedAt).toBe('string');
      expect(result).toHaveProperty('newRatesDetected');
    });

    it('returns newRatesDetected=false when discovery is disabled', async () => {
      const service = createService({ discoveryDisabled: true });
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
    });

    it('returns newRatesDetected=false by default (mock behaviour)', async () => {
      const service = createService();
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // createRateUpdateTask
  // ---------------------------------------------------------------------------

  describe('createRateUpdateTask', () => {
    it('creates a pending review entry when new rates are detected', async () => {
      const service = createService();
      const result = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      expect(result).toHaveProperty('id');
      expect(result.status).toBe('pending');
      expect(result.description).toContain('manual review required');
      expect(result.source).toBe('vero.fi (simulated check)');
    });

    it('throws when newRatesDetected is false', async () => {
      const service = createService();

      await expect(
        service.createRateUpdateTask({
          checkedAt: new Date().toISOString(),
          newRatesDetected: false,
        }),
      ).rejects.toThrow('Cannot create rate-update task');
    });

    it('uses provided reviewId when present', async () => {
      const service = createService();
      const customId = 'custom-review-id-42';

      const result = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
        reviewId: customId,
      });

      expect(result.id).toBe(customId);
    });

    it('persists the entry via the repository', async () => {
      const repo = createFakeRepository();
      const config = DEFAULT_RATE_REVIEW_CONFIG;
      const service = new RateReviewSchedulerService(repo, config);

      const reviewResult = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      // Verify the entry was stored
      const stored = await repo.findById(reviewResult.id);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe('pending');
    });
  });

  // ---------------------------------------------------------------------------
  // Rates NEVER auto-published — verified invariant
  // ---------------------------------------------------------------------------

  describe('never-auto-publish invariant', () => {
    it('createRateUpdateTask always returns pending status', async () => {
      const service = createService();

      const entry = await service.createRateUpdateTask({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
      });

      // The invariant: rates only go live after manual confirmation.
      // A "pending" entry means no automated publish path exists.
      expect(entry.status).toBe('pending');
    });

    it('checkForRateChanges never directly applies rate changes', async () => {
      const service = createService();

      // The checkForRateChanges method's contract is observational only:
      // it detects, it does not apply.
      const result = await service.checkForRateChanges();

      expect(result.newRatesDetected).toBe(false);
      expect(result).not.toHaveProperty('ratesApplied');
    });
  });

  // ---------------------------------------------------------------------------
  // scheduleNextReview / stopReviews
  // ---------------------------------------------------------------------------

  describe('scheduleNextReview / stopReviews', () => {
    it('scheduleNextReview sets up a repeating timer', () => {
      const service = createService();
      const spy = vi.spyOn(global, 'setInterval');

      service.scheduleNextReview();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        expect.any(Function),
        DEFAULT_RATE_REVIEW_CONFIG.checkIntervalMs,
      );
    });

    it('stopReviews clears the active timer', () => {
      const service = createService();
      const clearSpy = vi.spyOn(global, 'clearInterval');

      service.scheduleNextReview();
      service.stopReviews();

      expect(clearSpy).toHaveBeenCalled();
    });

    it('scheduleNextReview is idempotent (clears previous timer)', () => {
      const service = createService();
      const clearSpy = vi.spyOn(global, 'clearInterval');

      service.scheduleNextReview();
      service.scheduleNextReview();

      // First call sets a timer, second call clears it and sets a new one
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('stopReviews is safe when no timer is running', () => {
      const service = createService();

      expect(() => service.stopReviews()).not.toThrow();
    });
  });
});
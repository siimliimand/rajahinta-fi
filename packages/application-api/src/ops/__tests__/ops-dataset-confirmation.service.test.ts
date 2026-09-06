/**
 * OpsDatasetConfirmationService tests (task 12.1, change
 * technical-assessment-remediation).
 *
 * Exercises the console's InMemoryRateReviewRepository, a real
 * AuditService, and a real IdempotencyService over the in-memory cache —
 * asserting:
 * - the queue lists pending tax reviews;
 * - approving a tax review resolves + audits (+ invalidation when the
 *   entry names its version); rejecting keeps the previous version
 *   effective (no invalidation, no publish);
 * - HTTP-shaped errors: 404 unknown, 409 wrong-state.
 *
 * @module OpsDatasetConfirmationServiceTest
 */

import { describe, it, expect } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';
import type { CalculatorResult } from '@rajahinta/core-domain';
import { AuditService } from '@rajahinta/core-domain';
import type { RateReviewEntry } from '@rajahinta/data-acquisition';
import { InMemoryAuditRepository } from '../../audit/in-memory-audit.repository';
import { IdempotencyService, InMemoryIdempotencyCache } from '../../idempotency';
import { InMemoryRateReviewRepository } from '../confirmations/in-memory-rate-review.repository';
import { OpsDatasetConfirmationService } from '../confirmations/ops-dataset-confirmation.service';

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

function taxReview(overrides: Partial<RateReviewEntry> = {}): RateReviewEntry {
  return {
    id: 'review-1',
    createdAt: '2026-08-28T02:05:00.000Z',
    description: 'New official tax rates detected — manual review required',
    source: 'vero.fi (simulated check)',
    status: 'pending',
    versionLabel: 'v3.0-2026',
    confirmedBy: 'Matti Meikäläinen',
    confirmedRole: 'Finnish Tax Counsel',
    ...overrides,
  };
}

function createHarness() {
  const taxReviews = new InMemoryRateReviewRepository();
  const auditRepo = new InMemoryAuditRepository();
  const cache = new InMemoryIdempotencyCache();

  const service = new OpsDatasetConfirmationService(
    taxReviews,
    new IdempotencyService(cache),
    new AuditService(auditRepo),
  );
  return { taxReviews, auditRepo, cache, service };
}

/** Seed one cache entry keyed on the given dataset versions. */
async function seedCacheEntry(
  cache: InMemoryIdempotencyCache,
  key: string,
  datasetVersions: string[],
): Promise<void> {
  await cache.set(key, {
    result: { metadata: { datasetVersions } } as unknown as CalculatorResult,
    datasetVersions,
    createdAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpsDatasetConfirmationService', () => {
  describe('listPendingConfirmations', () => {
    it('lists pending tax reviews', async () => {
      const { taxReviews, service } = createHarness();
      await taxReviews.create(taxReview());
      await taxReviews.create(taxReview({ id: 'review-2', status: 'resolved', resolution: 'approve' }));

      const queue = await service.listPendingConfirmations();

      expect(queue.taxReviews).toHaveLength(1);
      expect(queue.taxReviews[0].id).toBe('review-1');
      expect(queue.taxReviews[0].versionLabel).toBe('v3.0-2026');
    });
  });

  describe('approveTaxReview', () => {
    it('resolves as approve, audits operator identity, and invalidates the named version', async () => {
      const { taxReviews, auditRepo, cache, service } = createHarness();
      await taxReviews.create(taxReview());
      await seedCacheEntry(cache, 'key-tax', ['v3.0-2026']);

      const result = await service.approveTaxReview('review-1', {
        operator: 'op@rajahinta.fi',
        note: 'Rates match the official publication',
      });

      expect(result).toMatchObject({ id: 'review-1', status: 'resolved', resolution: 'approve' });
      expect(await cache.get('key-tax')).toBeNull(); // version under review recomputed

      const trail = await auditRepo.query({ entityType: 'tax_rule_version' });
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe('confirmed');
      expect(trail[0].author).toBe('op@rajahinta.fi');
    });

    it('404s unknown reviews and 409s already-resolved ones', async () => {
      const { taxReviews, service } = createHarness();
      await taxReviews.create(taxReview({ id: 'done', status: 'resolved', resolution: 'approve' }));

      await expect(service.approveTaxReview('missing', { operator: 'op' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.approveTaxReview('done', { operator: 'op' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('rejectTaxReview', () => {
    it('resolves as reject, audits, and keeps the previous version effective (no invalidation)', async () => {
      const { taxReviews, auditRepo, cache, service } = createHarness();
      await taxReviews.create(taxReview());
      await seedCacheEntry(cache, 'key-tax', ['v3.0-2026']);

      const result = await service.rejectTaxReview('review-1', {
        operator: 'op@rajahinta.fi',
        note: 'Detected change did not match the official publication',
      });

      expect(result).toMatchObject({ id: 'review-1', status: 'resolved', resolution: 'reject' });
      expect(await cache.get('key-tax')).not.toBeNull(); // previous version stays effective

      const trail = await auditRepo.query({ entityType: 'tax_rule_version' });
      expect(trail[0].action).toBe('updated');
      expect(trail[0].newValue).toMatchObject({ resolution: 'reject' });
    });
  });
});

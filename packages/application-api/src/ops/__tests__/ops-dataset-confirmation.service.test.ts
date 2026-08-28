/**
 * OpsDatasetConfirmationService tests (task 12.1, change
 * technical-assessment-remediation).
 *
 * Exercises the REAL core-domain FxRateDatasetService over an in-memory FX
 * port (lifecycle rules are the launch-blocking policy), the console's
 * InMemoryRateReviewRepository, a real AuditService, and a real
 * IdempotencyService over the in-memory cache — asserting:
 * - the queue lists PENDING_CONFIRMATION FX datasets (with rates) and
 *   pending tax reviews;
 * - FX confirmation publishes, audits operator + timestamp, and
 *   invalidates idempotency entries keyed on the OLD (replaced) dataset
 *   version — the dataset-version comparison convention;
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
import {
  AuditService,
  FxRateDatasetService,
  type FxDatasetVersion,
  type FxRateEntry,
  type IFxRateDatasetRepositoryPort,
  type NewFxDataset,
} from '@rajahinta/core-domain';
import type { RateReviewEntry } from '@rajahinta/data-acquisition';
import { InMemoryAuditRepository } from '../../audit/in-memory-audit.repository';
import { IdempotencyService, InMemoryIdempotencyCache } from '../../idempotency';
import { InMemoryRateReviewRepository } from '../confirmations/in-memory-rate-review.repository';
import { OpsDatasetConfirmationService } from '../confirmations/ops-dataset-confirmation.service';

// ---------------------------------------------------------------------------
// In-memory FX port (mirrors the storage-boundary invariants)
// ---------------------------------------------------------------------------

class InMemoryFxRepo implements IFxRateDatasetRepositoryPort {
  datasets: FxDatasetVersion[] = [];
  rates = new Map<number, FxRateEntry[]>();
  private nextId = 1;

  async createDataset(input: NewFxDataset): Promise<FxDatasetVersion> {
    const created: FxDatasetVersion = {
      id: this.nextId++,
      versionLabel: input.versionLabel,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl ?? null,
      referenceDate: input.referenceDate,
      status: 'PENDING_CONFIRMATION',
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      confirmedBy: null,
      confirmedAt: null,
      createdAt: new Date('2026-08-28T06:00:00Z'),
    };
    this.datasets.push(created);
    this.rates.set(created.id, [...input.rates]);
    return created;
  }

  async findDatasetByVersionLabel(versionLabel: string) {
    return this.datasets.find((d) => d.versionLabel === versionLabel) ?? null;
  }

  async findDatasetById(id: number) {
    return this.datasets.find((d) => d.id === id) ?? null;
  }

  async findPendingDatasets() {
    return this.datasets.filter((d) => d.status === 'PENDING_CONFIRMATION');
  }

  async findPublishedDatasetEffectiveOn(asOf: Date) {
    let best: FxDatasetVersion | null = null;
    for (const d of this.datasets) {
      if (d.status !== 'PUBLISHED') continue;
      if (d.effectiveFrom.getTime() > asOf.getTime()) continue;
      if (d.effectiveTo !== null && d.effectiveTo.getTime() <= asOf.getTime()) continue;
      if (best === null || d.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = d;
    }
    return best;
  }

  async publishDataset(id: number, confirmedBy: string) {
    const index = this.datasets.findIndex((d) => d.id === id);
    const dataset = this.datasets[index];
    if (dataset === undefined || dataset.status !== 'PENDING_CONFIRMATION') return null;
    const published: FxDatasetVersion = {
      ...dataset,
      status: 'PUBLISHED',
      confirmedBy,
      confirmedAt: new Date(),
    };
    this.datasets[index] = published;
    return { ...published };
  }

  async findRatesForDataset(datasetId: number) {
    return this.rates.get(datasetId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures + harness
// ---------------------------------------------------------------------------

function fxPayload(overrides: Partial<NewFxDataset> = {}): NewFxDataset {
  return {
    versionLabel: 'ecb-2026-08-27',
    sourceName: 'ecb-reference-rates',
    sourceUrl: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    referenceDate: '2026-08-27',
    effectiveFrom: new Date('2026-08-27T00:00:00Z'),
    effectiveTo: null,
    rates: [
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.32 },
      { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.85 },
    ],
    ...overrides,
  };
}

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
  const fxRepo = new InMemoryFxRepo();
  const taxReviews = new InMemoryRateReviewRepository();
  const auditRepo = new InMemoryAuditRepository();
  const cache = new InMemoryIdempotencyCache();

  const service = new OpsDatasetConfirmationService(
    new FxRateDatasetService(fxRepo),
    fxRepo,
    taxReviews,
    new IdempotencyService(cache),
    new AuditService(auditRepo),
  );
  return { fxRepo, taxReviews, auditRepo, cache, service };
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
    it('lists pending FX datasets with provenance and rates plus pending tax reviews', async () => {
      const { fxRepo, taxReviews, service } = createHarness();
      await fxRepo.createDataset(fxPayload());
      await fxRepo.publishDataset(1, 'predecessor-operator'); // published → not listed
      await fxRepo.createDataset(fxPayload({ versionLabel: 'ecb-2026-08-28' }));
      await taxReviews.create(taxReview());
      await taxReviews.create(taxReview({ id: 'review-2', status: 'resolved', resolution: 'approve' }));

      const queue = await service.listPendingConfirmations();

      expect(queue.fx).toHaveLength(1);
      expect(queue.fx[0].versionLabel).toBe('ecb-2026-08-28');
      expect(queue.fx[0].rates).toEqual([
        { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.32 },
        { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.85 },
      ]);
      expect(queue.fx[0].sourceName).toBe('ecb-reference-rates');

      expect(queue.taxReviews).toHaveLength(1);
      expect(queue.taxReviews[0].id).toBe('review-1');
      expect(queue.taxReviews[0].versionLabel).toBe('v3.0-2026');
    });
  });

  describe('confirmFxDataset', () => {
    it('publishes, audits operator + timestamp, and invalidates entries keyed on the replaced version', async () => {
      const { fxRepo, auditRepo, cache, service } = createHarness();
      const predecessor = await fxRepo.createDataset(fxPayload());
      await fxRepo.publishDataset(predecessor.id, 'previous-operator');
      const pending = await fxRepo.createDataset(
        fxPayload({ versionLabel: 'ecb-2026-08-28', referenceDate: '2026-08-28' }),
      );
      await seedCacheEntry(cache, 'key-old', [predecessor.versionLabel]);
      await seedCacheEntry(cache, 'key-unrelated', ['v3.0-2026']);

      const result = await service.confirmFxDataset(pending.id, {
        operator: 'op@rajahinta.fi',
        note: 'Matched the ECB daily publication',
      });

      expect(result.status).toBe('PUBLISHED');
      expect(result.versionLabel).toBe('ecb-2026-08-28');
      expect(result.invalidatedVersion).toBe(predecessor.versionLabel);

      // Old-version entries invalidated; unrelated entries untouched.
      expect(await cache.get('key-old')).toBeNull();
      expect(await cache.get('key-unrelated')).not.toBeNull();

      const trail = await auditRepo.query({ entityType: 'fx_rate_dataset' });
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe('confirmed');
      expect(trail[0].author).toBe('op@rajahinta.fi');
      expect(trail[0].entityId).toBe('ecb-2026-08-28');
      expect(trail[0].newValue).toMatchObject({ status: 'PUBLISHED' });
    });

    it('reports no invalidation when no published predecessor exists', async () => {
      const { fxRepo, service } = createHarness();
      const first = await fxRepo.createDataset(fxPayload());

      const result = await service.confirmFxDataset(first.id, { operator: 'op' });

      expect(result.invalidatedVersion).toBeNull();
      expect(result.status).toBe('PUBLISHED');
    });

    it('404s for an unknown dataset and 409s for an already-published one', async () => {
      const { fxRepo, service } = createHarness();
      const dataset = await fxRepo.createDataset(fxPayload());
      await fxRepo.publishDataset(dataset.id, 'op');

      await expect(
        service.confirmFxDataset(999, { operator: 'op' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.confirmFxDataset(dataset.id, { operator: 'op' }),
      ).rejects.toBeInstanceOf(ConflictException);
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

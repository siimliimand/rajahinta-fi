/**
 * Tax dataset-review + transport freshness cron handler tests (task
 * 4.3) — RateReviewSchedulerService semantics behind the snapshot-source
 * interface, and the transport freshness read + assessment.
 *
 * @module DatasetReviewCronTest
 */

import { describe, it, expect, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  DisabledRateChangeSource,
  handleTaxDatasetReview,
  toTaxReviewCheckResult,
} from '../tax-dataset-review';
import type { RateReviewResult } from '../../../../../packages/data-acquisition/src/interfaces/rate-review.types';
import {
  assessFreshness,
  handleTransportRateRefresh,
} from '../transport-rate-refresh';
import {
  idempotencyGet,
  idempotencyPut,
} from '../../do/client';
import { IdempotencyDO } from '../../do/idempotency.do';
import {
  createMemoryDoState,
  createMemoryDoStorage,
} from '../../do/__tests__/memory-do-storage';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';

const LOG: Logger = createLogger('error');

function createEnv(): { env: Env; db: DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
}

// ---------------------------------------------------------------------------
// Tax-dataset review
// ---------------------------------------------------------------------------

describe('tax-dataset-review cron handler', () => {
  it('the disabled placeholder source reports no change (pre-R2 state)', async () => {
    const { env } = createEnv();
    const invalidate = vi.fn();

    const result = await handleTaxDatasetReview(env, LOG, {
      rateChangeSource: new DisabledRateChangeSource(),
      invalidateVersions: invalidate,
    });

    expect(result).toEqual({ datasetsFound: 0, requiresConfirmation: false });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('maps a detection to a confirmation task and invalidates the dataset versions', async () => {
    const { env } = createEnv();
    const invalidate = vi.fn();
    const detectingSource = {
      checkForChanges: async (): Promise<RateReviewResult> => ({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
        reviewId: 'review-1',
        detectedVersions: ['snapshot-hash:abc123def456'],
      }),
    };

    const result = await handleTaxDatasetReview(env, LOG, {
      rateChangeSource: detectingSource,
      invalidateVersions: invalidate,
    });

    expect(result).toEqual({
      datasetsFound: 1,
      requiresConfirmation: true,
      detectedVersions: ['snapshot-hash:abc123def456'],
    });
    expect(invalidate).toHaveBeenCalledWith(['snapshot-hash:abc123def456']);
  });

  it('defaults invalidation to the IdempotencyDO client — cached entries for the replaced version vanish', async () => {
    const storage = createMemoryDoStorage();
    const instance = new IdempotencyDO(createMemoryDoState(storage), {});
    const stub = { fetch: (request: Request) => instance.fetch(request) };
    const namespace = {
      idFromName: (name: string) => ({ name }),
      get: () => stub,
    } as unknown as DurableObjectNamespace;
    const { d1 } = openMigratedD1();
    const env = { IDEMPOTENCY: namespace, DB: d1 } as unknown as Env;

    // Seed a cached calculation carrying the replaced dataset version.
    const input = { productId: 1, quantity: 1, destination: 'FI' };
    await idempotencyPut(env, input, { totalCents: 100 }, { datasetVersions: ['tax-v2'] });
    expect(await idempotencyGet(env, input)).not.toBeNull();

    const detectingSource = {
      checkForChanges: async (): Promise<RateReviewResult> => ({
        checkedAt: new Date().toISOString(),
        newRatesDetected: true,
        detectedVersions: ['tax-v2'],
      }),
    };
    await handleTaxDatasetReview(env, LOG, { rateChangeSource: detectingSource });

    expect(await idempotencyGet(env, input)).toBeNull();
  });

  it('toTaxReviewCheckResult mirrors the PipelineTaxDatasetReviewAdapter mapping', () => {
    expect(
      toTaxReviewCheckResult({
        checkedAt: 'x',
        newRatesDetected: false,
      }),
    ).toEqual({ datasetsFound: 0, requiresConfirmation: false });
    expect(
      toTaxReviewCheckResult({
        checkedAt: 'x',
        newRatesDetected: true,
        reviewId: 'r',
        detectedVersions: ['v1', 'v2'],
      }),
    ).toEqual({
      datasetsFound: 1,
      requiresConfirmation: true,
      detectedVersions: ['v1', 'v2'],
    });
  });
});

// ---------------------------------------------------------------------------
// Transport-rate refresh
// ---------------------------------------------------------------------------

describe('transport-rate-refresh cron handler', () => {
  it('reads the newest observed_at through the injected seam and assesses freshness', async () => {
    const { env } = createEnv();
    const findNewestObservedAt = vi
      .fn()
      .mockResolvedValue(new Date(Date.now() - 3_600_000));

    const result = await handleTransportRateRefresh(env, LOG, {
      findNewestObservedAt,
    });

    expect(findNewestObservedAt).toHaveBeenCalledTimes(1);
    expect(result.newestOfferObservedAt).not.toBeNull();
  });

  it('reads the newest observed_at from D1 by default (the append path is retired — curated-rate-refresh.ts owns writes)', async () => {
    const { env } = createEnv();
    const result = await handleTransportRateRefresh(env, LOG, {});
    expect(result.newestOfferObservedAt).toBeNull();
  });
});

describe('assessFreshness (curated review-cadence thresholds — 45/90 days)', () => {
  const error = vi.fn();
  const log: Logger = { ...LOG, error };

  it('alerts when no transport offers exist (degenerate +Inf case)', () => {
    error.mockClear();
    assessFreshness(log, null);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('TRANSPORT_FRESHNESS_ALERT'),
      }),
    );
  });

  it('warns past the 45-day review-cadence warning', () => {
    error.mockClear();
    assessFreshness(log, new Date(Date.now() - 46 * 86_400_000));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('TRANSPORT_FRESHNESS_ALERT (warning)'),
      }),
    );
  });

  it('escalates to critical past the 90-day level', () => {
    error.mockClear();
    assessFreshness(log, new Date(Date.now() - 91 * 86_400_000));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('TRANSPORT_FRESHNESS_ALERT (critical)'),
      }),
    );
  });

  it('stays silent inside the 45-day warning', () => {
    error.mockClear();
    assessFreshness(log, new Date(Date.now() - 30 * 86_400_000));
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the metric-contract name in the alert line', () => {
    error.mockClear();
    assessFreshness(log, null);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('rajahinta_transport_newest_offer_age_seconds'),
      }),
    );
  });
});

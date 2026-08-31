/**
 * Tax/FX dataset-review + transport-refresh cron handler tests (task
 * 4.3) — RateReviewSchedulerService semantics behind the snapshot-source
 * interface, the FX PENDING_CONFIRMATION flow against the real D1 fx
 * tables, and the transport refresh + freshness assessment.
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
import { handleFxDatasetReview } from '../fx-dataset-review';
import type { IFxRateSource } from '../../../../../packages/data-acquisition/src/interfaces/fx-rate-source.port';
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
// FX-dataset review
// ---------------------------------------------------------------------------

function fxSource(
  snapshot: Parameters<IFxRateSource['fetchLatestRates']> extends never
    ? never
    : {
        snapshot: {
          sourceId: string;
          sourceName: string;
          sourceUrl: string | null;
          referenceDate: string;
          rates: { baseCurrency: string; quoteCurrency: string; rate: number }[];
        } | null;
        errors: string[];
      },
): IFxRateSource {
  return {
    sourceId: snapshot.snapshot?.sourceId ?? 'fake',
    fetchLatestRates: async () => snapshot,
  };
}

describe('fx-dataset-review cron handler', () => {
  it('creates a PENDING_CONFIRMATION dataset for a new reference date — never publishes', async () => {
    const { env, db } = createEnv();

    const result = await handleFxDatasetReview(env, LOG, {
      rateSource: fxSource({
        snapshot: {
          sourceId: 'ecb',
          sourceName: 'ecb-reference-rates',
          sourceUrl: 'https://ecb.example/rates',
          referenceDate: '2026-08-28',
          rates: [
            { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.02 },
            { baseCurrency: 'EUR', quoteCurrency: 'USD', rate: 1.08 },
          ],
        },
        errors: [],
      }),
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.datasetsFound).toBe(1);
    expect(result.detectedVersions).toEqual(['ecb-2026-08-28']);

    const row = db
      .prepare(
        `SELECT status, version_label FROM fx_rate_datasets WHERE version_label = 'ecb-2026-08-28'`,
      )
      .get() as { status: string; version_label: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.status).toBe('PENDING_CONFIRMATION');
  });

  it('is idempotent — a known reference date is a no-op', async () => {
    const { env } = createEnv();
    const source = fxSource({
      snapshot: {
        sourceId: 'ecb',
        sourceName: 'ecb-reference-rates',
        sourceUrl: null,
        referenceDate: '2026-08-28',
        rates: [{ baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.02 }],
      },
      errors: [],
    });

    await handleFxDatasetReview(env, LOG, { rateSource: source });
    const second = await handleFxDatasetReview(env, LOG, { rateSource: source });

    expect(second.datasetsFound).toBe(0);
    expect(second.detectedVersions).toEqual(['ecb-2026-08-28']);
  });

  it('surfaces source errors without throwing', async () => {
    const { env } = createEnv();
    const result = await handleFxDatasetReview(env, LOG, {
      rateSource: fxSource({ snapshot: null, errors: ['ECB fetch failed: HTTP 503'] }),
    });
    expect(result.datasetsFound).toBe(0);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.errors).toEqual(['ECB fetch failed: HTTP 503']);
  });
});

// ---------------------------------------------------------------------------
// Transport-rate refresh
// ---------------------------------------------------------------------------

describe('transport-rate-refresh cron handler', () => {
  it('refreshes all carriers through the wildcard and assesses freshness', async () => {
    const { env } = createEnv();
    const refresh = vi.fn().mockResolvedValue({
      ratesUpdated: 3,
      newestOfferObservedAt: new Date(Date.now() - 3_600_000),
    });

    const result = await handleTransportRateRefresh(env, LOG, { refresh });

    expect(refresh).toHaveBeenCalledWith('*');
    expect(result.ratesUpdated).toBe(3);
  });

  it('composes the pipeline adapter by default (governance gate over the wildcard)', async () => {
    const { env } = createEnv();
    // Default composition with the fail-closed in-memory governance store:
    // no permitted carriers → nothing written, newest offer read from D1.
    const result = await handleTransportRateRefresh(env, LOG, {});
    expect(result.ratesUpdated).toBe(0);
    expect(result.newestOfferObservedAt).toBeNull();
  });
});

describe('assessFreshness (7-day transport staleness invariant)', () => {
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

  it('alerts when the newest offer exceeds the 7-day threshold', () => {
    error.mockClear();
    assessFreshness(log, new Date(Date.now() - 8 * 86_400_000));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('TRANSPORT_FRESHNESS_ALERT'),
      }),
    );
  });

  it('stays silent inside the threshold', () => {
    error.mockClear();
    assessFreshness(log, new Date(Date.now() - 86_400_000));
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

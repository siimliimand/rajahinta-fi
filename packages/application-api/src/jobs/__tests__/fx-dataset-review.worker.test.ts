/**
 * FxDatasetReviewWorker tests (task 1.3, change
 * technical-assessment-remediation).
 *
 * Pins the worker's review-workflow surface: a confirmation-requiring
 * check logs the never-auto-published warning, source errors are
 * surfaced as warnings, and a quiet check logs normally — mirroring
 * the tax-dataset-review worker contract.
 *
 * @module FxDatasetReviewWorkerTest
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { FxDatasetReviewResult } from '@rajahinta/data-acquisition';
import { FxDatasetReviewWorker } from '../workers/fx-dataset-review.worker';
import type { FxDatasetReviewJobData } from '../workers/fx-dataset-review.worker';
import type { Job } from 'bullmq';

function createJob(): Job<FxDatasetReviewJobData> {
  return { data: {}, attemptsMade: 0 } as unknown as Job<FxDatasetReviewJobData>;
}

function createService(result: Partial<FxDatasetReviewResult>) {
  return {
    checkForNewRates: vi.fn().mockResolvedValue({
      checkedAt: new Date().toISOString(),
      datasetsFound: 0,
      requiresConfirmation: false,
      detectedVersions: [],
      errors: [],
      ...result,
    }),
  };
}

describe('FxDatasetReviewWorker', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the source check and warns that nothing auto-publishes when confirmation is required', async () => {
    const service = createService({
      datasetsFound: 1,
      requiresConfirmation: true,
      detectedVersions: ['ecb-2026-08-27'],
    });
    const worker = new FxDatasetReviewWorker(service as never);

    await worker.process(createJob());

    expect(service.checkForNewRates).toHaveBeenCalledOnce();
    const warning = warnSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(warning).toContain('ecb-2026-08-27');
    expect(warning).toContain('no rates auto-published');
  });

  it('surfaces source errors as warnings without failing the job', async () => {
    const service = createService({
      errors: ['ECB fetch failed: HTTP 503: unavailable'],
    });
    const worker = new FxDatasetReviewWorker(service as never);

    await expect(worker.process(createJob())).resolves.toBeUndefined();

    const warning = warnSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(warning).toContain('HTTP 503');
  });

  it('logs a quiet check normally', async () => {
    const service = createService({});
    const worker = new FxDatasetReviewWorker(service as never);

    await worker.process(createJob());

    expect(warnSpy).not.toHaveBeenCalled();
    expect(
      logSpy.mock.calls.map((c) => String(c[0])).join(' '),
    ).toContain('No new FX datasets');
  });
});

/**
 * Tax-dataset review cron ↔ R2 rate-snapshot source integration (task
 * 4.4) — the composed default source against a fake RATE_SNAPSHOTS
 * bucket: detection → manual-confirmation mapping + version
 * invalidation, the missing-object fail-safe, and the no-binding
 * placeholder fallback.
 *
 * @module RateSnapshotCronIntegrationTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeRateChangeSource,
  handleTaxDatasetReview,
} from '../tax-dataset-review';
import {
  DEFAULT_RATE_SNAPSHOT_OBJECT_KEY,
  R2RateSnapshotSource,
} from '../../../../../packages/data-acquisition/src/adapters/rate-snapshot.r2';
import { InMemoryRateReviewRepository } from '../../../../../packages/data-acquisition/src/adapters/rate-review-repository.adapter';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';

const LOG: Logger = createLogger('error');

const SNAPSHOT_CONTENT = JSON.stringify({
  _source: 'vero.fi baseline snapshot',
  versions: { 'v3.0-2026': { beer: { rate: '36.71' } } },
});

interface RecordedBucket {
  binding: R2Bucket;
  requestedKeys: string[];
}

/** Fake R2 bucket recording requested keys and serving one object. */
function fakeR2(objects: Record<string, string>): RecordedBucket {
  const requestedKeys: string[] = [];
  return {
    requestedKeys,
    binding: {
      get: async (key: string) => {
        requestedKeys.push(key);
        const body = objects[key];
        if (body === undefined) return null;
        return { text: async () => body };
      },
    } as unknown as R2Bucket,
  };
}

function envWithBucket(bucket?: R2Bucket, key?: string): Env {
  return {
    ...(bucket ? { RATE_SNAPSHOTS: bucket } : {}),
    ...(key !== undefined ? { RATE_SNAPSHOT_OBJECT_KEY: key } : {}),
  } as unknown as Env;
}

describe('composeRateChangeSource (task 4.4 swap)', () => {
  it('composes the R2 source when the RATE_SNAPSHOTS binding is present', () => {
    const { binding } = fakeR2({});
    const source = composeRateChangeSource(envWithBucket(binding), LOG);
    expect(source).toBeInstanceOf(R2RateSnapshotSource);
  });

  it('falls back to the disabled placeholder without the binding (pre-4.4 behavior)', async () => {
    const source = composeRateChangeSource(envWithBucket(), LOG);
    const result = await source.checkForChanges();
    expect(result.newRatesDetected).toBe(false);
  });

  it('honors the per-env object key, defaulting to config/rate-snapshot.json', async () => {
    const custom = fakeR2({ 'environments/staging/snapshot.json': SNAPSHOT_CONTENT });
    await composeRateChangeSource(
      envWithBucket(custom.binding, 'environments/staging/snapshot.json'),
      LOG,
    ).checkForChanges();
    expect(custom.requestedKeys).toEqual(['environments/staging/snapshot.json']);

    const defaulted = fakeR2({});
    await composeRateChangeSource(envWithBucket(defaulted.binding), LOG).checkForChanges();
    expect(defaulted.requestedKeys).toEqual([DEFAULT_RATE_SNAPSHOT_OBJECT_KEY]);
  });
});

describe('handleTaxDatasetReview with the R2-backed default source', () => {
  it('detects a snapshot change and invalidates the snapshot-hash version', async () => {
    const { binding } = fakeR2({ [DEFAULT_RATE_SNAPSHOT_OBJECT_KEY]: SNAPSHOT_CONTENT });
    const invalidate = vi.fn().mockResolvedValue(0);

    const result = await handleTaxDatasetReview(envWithBucket(binding), LOG, {
      invalidateVersions: invalidate,
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.datasetsFound).toBe(1);
    const version = result.detectedVersions![0];
    expect(version).toMatch(/^snapshot-hash:[0-9a-f]{12}$/);
    expect(invalidate).toHaveBeenCalledWith([version]);
  });

  it('is quiet (no detection) while the reviewed hash matches the object', async () => {
    const repository = new InMemoryRateReviewRepository();
    const bytes = new TextEncoder().encode(SNAPSHOT_CONTENT);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await repository.create({
      id: 'review-1',
      createdAt: new Date().toISOString(),
      description: 'baseline reviewed',
      source: 'snapshot',
      status: 'pending',
      contentHash: hash,
    });

    const source = new R2RateSnapshotSource(
      fakeR2({ [DEFAULT_RATE_SNAPSHOT_OBJECT_KEY]: SNAPSHOT_CONTENT }).binding,
      DEFAULT_RATE_SNAPSHOT_OBJECT_KEY,
      repository,
      { logger: LOG },
    );
    const result = await handleTaxDatasetReview(envWithBucket(), LOG, {
      rateChangeSource: source,
      invalidateVersions: vi.fn(),
    });

    expect(result).toEqual({ datasetsFound: 0, requiresConfirmation: false });
  });

  it('missing snapshot object degrades to no-change with a warning — no invalidation', async () => {
    const warn = vi.fn();
    const log: Logger = { ...LOG, warn };
    const { binding } = fakeR2({});
    const invalidate = vi.fn();

    const result = await handleTaxDatasetReview(envWithBucket(binding), log, {
      invalidateVersions: invalidate,
    });

    expect(result).toEqual({ datasetsFound: 0, requiresConfirmation: false });
    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('not found'),
      }),
    );
  });
});

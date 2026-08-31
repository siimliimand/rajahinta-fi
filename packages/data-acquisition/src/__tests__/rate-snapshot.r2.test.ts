/**
 * R2RateSnapshotSource tests (task 4.4, design D6) — hash-compare PARITY
 * against the file-based ConfigBackedRateChangeSource (same bytes → same
 * verdict and the same detected-version label), the missing-object
 * fail-safe, and graceful degradation on bucket/repository failures.
 *
 * @module RateSnapshotR2Test
 */

import { describe, it, expect, vi } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigBackedRateChangeSource } from '../services/rate-review-scheduler.service';
import {
  R2RateSnapshotSource,
  sha256Hex,
  DEFAULT_RATE_SNAPSHOT_OBJECT_KEY,
  type RateSnapshotBucket,
  type RateSnapshotLogger,
} from '../adapters/rate-snapshot.r2';
import { InMemoryRateReviewRepository } from '../adapters/rate-review-repository.adapter';
import type { RateReviewEntry } from '../interfaces/rate-review.types';

const BASELINE_CONTENT = JSON.stringify({
  _source: 'baseline — current official 2024/2025/2026 rates',
  versions: { 'v3.0-2026': { beer: { rate: '36.71', unit: 'snt/cl' } } },
});

const CHANGED_CONTENT = JSON.stringify({
  _source: '2027 proposed rates',
  versions: { 'v4.0-2027': { beer: { rate: '37.50', unit: 'snt/cl' } } },
});

const quietLogger: RateSnapshotLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Fake bucket serving one object from an in-memory map. */
function fakeBucket(objects: Record<string, string>): RateSnapshotBucket {
  return {
    get: async (key) => {
      const body = objects[key];
      if (body === undefined) return null;
      return { text: async () => body };
    },
  };
}

/**
 * Write `content` to a temp snapshot FILE and serve the SAME bytes from
 * a fake R2 bucket — one ConfigBacked (file) source and one R2 source
 * over the SAME repository. Parity is asserted between their verdicts.
 */
async function parityHarness(content: string, repository: InMemoryRateReviewRepository) {
  const tmpDir = await fs.mkdtemp('/tmp/rate-snapshot-r2-parity-');
  const snapshotPath = path.join(tmpDir, 'snapshot.json');
  await fs.writeFile(snapshotPath, content, 'utf-8');

  const fileSource = new ConfigBackedRateChangeSource(snapshotPath, repository);
  const r2Source = new R2RateSnapshotSource(
    fakeBucket({ 'config/rate-snapshot.json': content }),
    'config/rate-snapshot.json',
    repository,
    { logger: quietLogger },
  );

  return {
    repository,
    checkBoth: async () => [await fileSource.checkForChanges(), await r2Source.checkForChanges()] as const,
    cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
  };
}

function entryWithHash(hash: string | undefined): Omit<RateReviewEntry, 'id' | 'createdAt'> {
  return {
    description: 'parity harness entry',
    source: 'snapshot',
    status: 'pending',
    ...(hash !== undefined ? { contentHash: hash } : {}),
  };
}

describe('sha256Hex — WebCrypto vs Node crypto parity', () => {
  it('produces the identical hex digest over the same UTF-8 bytes', async () => {
    const expected = crypto.createHash('sha256').update(BASELINE_CONTENT).digest('hex');
    expect(await sha256Hex(BASELINE_CONTENT)).toBe(expected);
    // Different bytes → different digest (sanity).
    expect(await sha256Hex(CHANGED_CONTENT)).not.toBe(expected);
  });
});

describe('R2RateSnapshotSource — parity with the file-based source', () => {
  it('same bytes → same verdict on first check (no review entries): both detect, same label', async () => {
    const harness = await parityHarness(BASELINE_CONTENT, new InMemoryRateReviewRepository());
    try {
      const [fileResult, r2Result] = await harness.checkBoth();

      expect(fileResult.newRatesDetected).toBe(true);
      expect(r2Result.newRatesDetected).toBe(true);
      expect(r2Result.detectedVersions).toEqual(fileResult.detectedVersions);
      expect(r2Result.detectedVersions![0]).toMatch(/^snapshot-hash:[0-9a-f]{12}$/);
    } finally {
      await harness.cleanup();
    }
  });

  it('same bytes → same no-change verdict once the entry records the matching hash', async () => {
    const repository = new InMemoryRateReviewRepository();
    const hash = crypto.createHash('sha256').update(BASELINE_CONTENT).digest('hex');
    await repository.create({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entryWithHash(hash),
    });

    const harness = await parityHarness(BASELINE_CONTENT, repository);
    try {
      const [fileResult, r2Result] = await harness.checkBoth();

      expect(fileResult.newRatesDetected).toBe(false);
      expect(r2Result.newRatesDetected).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it('same bytes → same detection when the snapshot content changes (2027 simulation)', async () => {
    const repository = new InMemoryRateReviewRepository();
    const baselineHash = crypto.createHash('sha256').update(BASELINE_CONTENT).digest('hex');
    await repository.create({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entryWithHash(baselineHash),
    });

    const harness = await parityHarness(CHANGED_CONTENT, repository);
    try {
      const [fileResult, r2Result] = await harness.checkBoth();

      expect(fileResult.newRatesDetected).toBe(true);
      expect(r2Result.newRatesDetected).toBe(true);
      expect(r2Result.detectedVersions).toEqual(fileResult.detectedVersions);
      // The label reflects the NEW content hash, not the reviewed one.
      const newHash = await sha256Hex(CHANGED_CONTENT);
      expect(r2Result.detectedVersions![0]).toBe(`snapshot-hash:${newHash.slice(0, 12)}`);
    } finally {
      await harness.cleanup();
    }
  });

  it('same bytes → same detection when the latest entry carries no contentHash', async () => {
    const repository = new InMemoryRateReviewRepository();
    await repository.create({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entryWithHash(undefined),
    });

    const harness = await parityHarness(BASELINE_CONTENT, repository);
    try {
      const [fileResult, r2Result] = await harness.checkBoth();

      expect(fileResult.newRatesDetected).toBe(true);
      expect(r2Result.newRatesDetected).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('prefers pending over resolved entries — the ConfigBacked precedence', async () => {
    const repository = new InMemoryRateReviewRepository();
    const changedHash = crypto.createHash('sha256').update(CHANGED_CONTENT).digest('hex');
    // An old RESOLVED entry carrying the CHANGED hash, then a newer
    // PENDING one carrying the BASELINE hash: pending wins → the
    // baseline object is a no-change, the changed object is a detection.
    await repository.create({
      id: crypto.randomUUID(),
      createdAt: '2026-08-01T00:00:00.000Z',
      ...entryWithHash(changedHash),
      status: 'resolved',
    });
    const baselineHash = crypto.createHash('sha256').update(BASELINE_CONTENT).digest('hex');
    await repository.create({
      id: crypto.randomUUID(),
      createdAt: '2026-08-02T00:00:00.000Z',
      ...entryWithHash(baselineHash),
    });

    const harness = await parityHarness(BASELINE_CONTENT, repository);
    try {
      const [fileResult, r2Result] = await harness.checkBoth();
      expect(fileResult.newRatesDetected).toBe(false);
      expect(r2Result.newRatesDetected).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});

describe('R2RateSnapshotSource — fail-safe behavior', () => {
  it('missing object = no-change + warning (the configured key is requested)', async () => {
    const warn = vi.fn();
    const source = new R2RateSnapshotSource(
      fakeBucket({}),
      'env-specific/snapshot.json',
      new InMemoryRateReviewRepository(),
      { logger: { warn } },
    );

    const result = await source.checkForChanges();

    expect(result.newRatesDetected).toBe(false);
    expect(result.checkedAt).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('env-specific/snapshot.json'),
      }),
    );
  });

  it('bucket read failure = no-change + error log (graceful degradation parity)', async () => {
    const error = vi.fn();
    const source = new R2RateSnapshotSource(
      {
        get: async () => {
          throw new Error('r2 unavailable');
        },
      },
      DEFAULT_RATE_SNAPSHOT_OBJECT_KEY,
      new InMemoryRateReviewRepository(),
      { logger: { error } },
    );

    const result = await source.checkForChanges();

    expect(result.newRatesDetected).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('r2 unavailable'),
      }),
    );
  });

  it('repository lookup failure = no-change + error log (never breaks the scheduler loop)', async () => {
    const error = vi.fn();
    const failingRepo = {
      findByStatus: async (): Promise<never[]> => {
        throw new Error('d1 unavailable');
      },
    };
    const source = new R2RateSnapshotSource(
      fakeBucket({ 'config/rate-snapshot.json': BASELINE_CONTENT }),
      'config/rate-snapshot.json',
      failingRepo as unknown as InMemoryRateReviewRepository,
      { logger: { error } },
    );

    const result = await source.checkForChanges();

    expect(result.newRatesDetected).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('d1 unavailable'),
      }),
    );
  });
});

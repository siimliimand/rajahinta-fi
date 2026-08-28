/**
 * JobsSchedulerService price-ingestion scheduling tests (task 7.3,
 * change technical-assessment-remediation; design D7; background-jobs
 * spec "Per-merchant ingestion scheduling").
 *
 * Pins the registry-driven contract:
 * - one job per permitted (governance-GRANTED) merchant with a feed
 *   URL, each deduped by its own per-merchant jobId;
 * - the catch-all `*` job is gone — no wildcard enqueues remain;
 * - unpermitted, ungoverned, and feed-less merchants schedule nothing
 *   (fail-closed: governance errors default to PENDING);
 * - one merchant's enqueue failure does not starve the others.
 *
 * @module JobsSchedulerPriceIngestionTest
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import type { SourceGovernanceService, PermissionCheckResult } from '@rajahinta/core-domain';
import type { MerchantRegistryRepository, MerchantRegistryRecord } from '@rajahinta/data-platform';
import type { Queue } from 'bullmq';
import { JobsSchedulerService } from '../jobs-scheduler.service';
import type { PriceIngestionJobData } from '../workers/price-ingestion.worker';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function registryRow(
  merchantId: string,
  overrides: Partial<MerchantRegistryRecord> = {},
): MerchantRegistryRecord {
  return {
    id: 1,
    merchantId,
    name: merchantId,
    country: 'FI',
    feedUrl: `https://${merchantId}.example.invalid/feed`,
    feedFormat: 'json',
    pollingIntervalMs: 3_600_000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeRegistry(rows: MerchantRegistryRecord[]): MerchantRegistryRepository {
  return { list: vi.fn().mockResolvedValue(rows) } as unknown as MerchantRegistryRepository;
}

function fakeGovernance(
  checkPermission: (merchantId: string) => Promise<PermissionCheckResult>,
): SourceGovernanceService {
  return {
    checkPermission: vi.fn(checkPermission),
  } as unknown as SourceGovernanceService;
}

function granted(): PermissionCheckResult {
  return {
    sources: [{ merchantId: 'x', permissionStatus: 'GRANTED' }],
    permissionStatus: 'GRANTED',
    warnings: [],
  } as unknown as PermissionCheckResult;
}

function revoked(): PermissionCheckResult {
  return {
    sources: [{ merchantId: 'x', permissionStatus: 'REVOKED' }],
    permissionStatus: 'REVOKED',
    warnings: [],
  } as unknown as PermissionCheckResult;
}

function noRecords(): PermissionCheckResult {
  return { sources: [], permissionStatus: 'PENDING', warnings: [] } as unknown as PermissionCheckResult;
}

interface CapturedAdd {
  name: string;
  data: PriceIngestionJobData;
  opts: { jobId?: string };
}

function captureQueue(): { queue: Queue<PriceIngestionJobData>; adds: CapturedAdd[] } {
  const adds: CapturedAdd[] = [];
  const queue = {
    add: vi.fn(async (name: string, data: PriceIngestionJobData, opts: { jobId?: string }) => {
      adds.push({ name, data, opts });
    }),
  };
  return { queue: queue as unknown as Queue<PriceIngestionJobData>, adds };
}

function createScheduler(
  registry: MerchantRegistryRepository,
  governance: SourceGovernanceService,
  queue: Queue<PriceIngestionJobData>,
): JobsSchedulerService {
  return new JobsSchedulerService(
    queue,
    {} as never, // transport queue — not under test
    {} as never, // tax review queue
    {} as never, // time-series queue
    {} as never, // fx review queue
    { scheduleNextReview: vi.fn() } as never,
    registry,
    governance,
  );
}

// ---------------------------------------------------------------------------

describe('JobsSchedulerService.schedulePriceIngestion (task 7.3)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues one job per permitted merchant, deduped by per-merchant jobIds', async () => {
    const registry = fakeRegistry([
      registryRow('alko'),
      registryRow('systembolaget', { country: 'SE' }),
      registryRow('third-merchant'),
    ]);
    const governance = fakeGovernance(async (merchantId) =>
      merchantId === 'third-merchant' ? revoked() : granted(),
    );
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toHaveLength(2);
    expect(adds.map((a) => a.data.merchantId).sort()).toEqual(['alko', 'systembolaget']);

    for (const add of adds) {
      // The dedupe key carries the merchant identity — per-merchant
      // dedupe, per-merchant monitoring visibility.
      expect(add.opts.jobId).toMatch(new RegExp(`^price-ingestion-${add.data.merchantId}-\\d{4}-\\d{2}-\\d{2}-\\d{2}$`));
      expect(add.data.sourceUrl).toContain(add.data.merchantId);
      // Queue-level backoff/retry defaults apply per job — per-merchant
      // by construction now that each merchant is its own job.
      expect(add.opts.jobId).not.toContain('*');
    }
  });

  it('never enqueues the catch-all wildcard job', async () => {
    const registry = fakeRegistry([registryRow('alko')]);
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, fakeGovernance(async () => granted()), queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toHaveLength(1);
    const wildcardEvidence = adds.filter(
      (a) => a.data.merchantId === '*' || a.name === 'hourly-refresh',
    );
    expect(wildcardEvidence).toEqual([]);
  });

  it('schedules nothing for merchants without governance records (fail-closed)', async () => {
    const registry = fakeRegistry([registryRow('alko')]);
    const governance = fakeGovernance(async () => noRecords());
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toEqual([]);
    expect(
      logSpy.mock.calls.map((c) => String(c[0])).join(' '),
    ).toContain('no governance records');
  });

  it('treats a governance outage as not permitted, never as granted', async () => {
    const registry = fakeRegistry([registryRow('alko')]);
    const governance = fakeGovernance(async () => {
      throw new Error('governance repository down');
    });
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toEqual([]);
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).join(' '),
    ).toContain('governance check failed');
  });

  it('skips registry merchants whose feed URL is empty (adapter not live)', async () => {
    const registry = fakeRegistry([
      registryRow('alko', { feedUrl: '' }),
      registryRow('systembolaget'),
    ]);
    const governance = fakeGovernance(async () => granted());
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds.map((a) => a.data.merchantId)).toEqual(['systembolaget']);
    // The empty-feed merchant is never even permission-checked.
    expect(governance.checkPermission).not.toHaveBeenCalledWith('alko');
  });

  it('continues enqueueing the remaining merchants when one add fails', async () => {
    const registry = fakeRegistry([registryRow('alko'), registryRow('systembolaget')]);
    const governance = fakeGovernance(async () => granted());
    const adds: CapturedAdd[] = [];
    const queue = {
      add: vi.fn(async (name: string, data: PriceIngestionJobData, opts: { jobId?: string }) => {
        if (data.merchantId === 'alko') {
          throw new Error('redis write failed');
        }
        adds.push({ name, data, opts });
      }),
    };
    const scheduler = createScheduler(
      registry,
      governance,
      queue as unknown as Queue<PriceIngestionJobData>,
    );

    await scheduler.schedulePriceIngestion();

    expect(adds.map((a) => a.data.merchantId)).toEqual(['systembolaget']);
    expect(
      errorSpy.mock.calls.map((c) => String(c[0])).join(' '),
    ).toMatch(/[Ff]ailed to enqueue price-ingestion job for merchant "alko"/);
  });

  it('logs a monitoring summary of the hourly sweep', async () => {
    const registry = fakeRegistry([registryRow('alko'), registryRow('pending-merchant')]);
    const governance = fakeGovernance(async (id) =>
      id === 'alko' ? granted() : noRecords(),
    );
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toHaveLength(1);
    expect(
      logSpy.mock.calls.map((c) => String(c[0])).join(' '),
    ).toContain('enqueued 1/2');
  });
});

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
      registryRow('eu-import', { country: 'DE' }),
      registryRow('third-merchant'),
    ]);
    const governance = fakeGovernance(async (merchantId) =>
      merchantId === 'third-merchant' ? revoked() : granted(),
    );
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds).toHaveLength(2);
    expect(adds.map((a) => a.data.merchantId).sort()).toEqual(['alko', 'eu-import']);

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
      registryRow('eu-import'),
    ]);
    const governance = fakeGovernance(async () => granted());
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(registry, governance, queue);

    await scheduler.schedulePriceIngestion();

    expect(adds.map((a) => a.data.merchantId)).toEqual(['eu-import']);
    // The empty-feed merchant is never even permission-checked.
    expect(governance.checkPermission).not.toHaveBeenCalledWith('alko');
  });

  it('continues enqueueing the remaining merchants when one add fails', async () => {
    const registry = fakeRegistry([registryRow('alko'), registryRow('eu-import')]);
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

    expect(adds.map((a) => a.data.merchantId)).toEqual(['eu-import']);
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

// ---------------------------------------------------------------------------
// Cadence gate (task 1.2, design D1) — mirrors the api-worker producer
// tests (task 1.1): synthetic clocks over consecutive hourly ticks, the
// same interval-bucket cases per merchant pollingIntervalMs.
// ---------------------------------------------------------------------------

describe('JobsSchedulerService.schedulePriceIngestion cadence gate (task 1.2)', () => {
  /** UTC hour stamp within the synthetic day 2026-09-13. */
  const at = (hour: number): string =>
    `2026-09-13T${String(hour).padStart(2, '0')}:00:00.000Z`;

  /** Pin the clock to `iso`, then run one hourly tick. */
  async function tick(scheduler: JobsSchedulerService, iso: string): Promise<void> {
    vi.setSystemTime(new Date(iso));
    await scheduler.schedulePriceIngestion();
  }

  function cadenceScheduler(
    rows: MerchantRegistryRecord[],
  ): { scheduler: JobsSchedulerService; adds: CapturedAdd[] } {
    const { queue, adds } = captureQueue();
    const scheduler = createScheduler(
      fakeRegistry(rows),
      fakeGovernance(async () => granted()),
      queue,
    );
    return { scheduler, adds };
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers({ now: new Date(at(0)), toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enqueues an hourly-interval merchant on every tick (behavior unchanged)', async () => {
    const { scheduler, adds } = cadenceScheduler([registryRow('alko')]);

    for (const hour of [0, 1, 2, 3]) {
      await tick(scheduler, at(hour));
    }

    expect(adds).toHaveLength(4);
    // jobId shape unchanged by the gate — one distinct hour bucket per tick.
    expect(adds.map((a) => a.opts.jobId)).toEqual([
      'price-ingestion-alko-2026-09-13-00',
      'price-ingestion-alko-2026-09-13-01',
      'price-ingestion-alko-2026-09-13-02',
      'price-ingestion-alko-2026-09-13-03',
    ]);
  });

  it('enqueues a daily-interval merchant exactly once across 24 consecutive ticks, at the first tick after 00:00 UTC', async () => {
    const { scheduler, adds } = cadenceScheduler([
      registryRow('alks', { pollingIntervalMs: 86_400_000 }),
    ]);

    for (let hour = 0; hour < 24; hour++) {
      await tick(scheduler, at(hour));
    }

    expect(adds).toHaveLength(1);
    expect(adds[0].data.merchantId).toBe('alks');
    expect(adds[0].opts.jobId).toBe('price-ingestion-alks-2026-09-13-00');
  });

  it('enqueues a 6-hour merchant at 00/06/12/18 UTC only', async () => {
    const { scheduler, adds } = cadenceScheduler([
      registryRow('alko', { pollingIntervalMs: 21_600_000 }),
    ]);

    for (let hour = 0; hour < 24; hour++) {
      await tick(scheduler, at(hour));
    }

    expect(adds.map((a) => a.opts.jobId)).toEqual([
      'price-ingestion-alko-2026-09-13-00',
      'price-ingestion-alko-2026-09-13-06',
      'price-ingestion-alko-2026-09-13-12',
      'price-ingestion-alko-2026-09-13-18',
    ]);
  });

  it('fires exactly on an interval boundary, not one millisecond before', async () => {
    const { scheduler, adds } = cadenceScheduler([
      registryRow('alks', { pollingIntervalMs: 86_400_000 }),
    ]);

    await tick(scheduler, '2026-09-12T23:59:59.999Z');
    expect(adds).toHaveLength(0);

    await tick(scheduler, '2026-09-13T00:00:00.000Z');
    expect(adds).toHaveLength(1);
    expect(adds[0].opts.jobId).toBe('price-ingestion-alks-2026-09-13-00');
  });

  it('self-heals a missed boundary at the next boundary, with no mid-bucket catch-up', async () => {
    // 6-hour boundaries at 00/06/12/18: the 06:00 tick is missed, the
    // stateless epoch-aligned gate refuses to fire mid-bucket (no stale
    // catch-up burst) and resumes exactly at the 12:00 boundary.
    const { scheduler, adds } = cadenceScheduler([
      registryRow('alko', { pollingIntervalMs: 21_600_000 }),
    ]);

    await tick(scheduler, at(0));
    expect(adds).toHaveLength(1);

    // 06:00 boundary tick missed; every later tick inside [06, 12) is inert.
    for (const hour of [7, 8, 9, 10, 11]) {
      await tick(scheduler, at(hour));
    }
    expect(adds).toHaveLength(1);

    await tick(scheduler, at(12));
    expect(adds).toHaveLength(2);
    expect(adds[1].opts.jobId).toBe('price-ingestion-alko-2026-09-13-12');
  });
});

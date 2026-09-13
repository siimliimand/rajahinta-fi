/**
 * Price-ingestion producer tests (task 4.1) — dedupe-key shape, the
 * GRANTED-only governance gate, empty-feedUrl skip, and enqueue-failure
 * isolation. Task 1.1 adds the interval-bucket cadence gate
 * (intervalBucketFires, design D1) with synthetic-clock cases: hourly,
 * daily, 6 h, missed-tick self-heal, exactly-on-boundary. The registry
 * runs on the real D1 repository over the fake-D1 harness (node:sqlite +
 * committed migrations); gate-side tests use the `checkPermission` seam
 * over the in-memory reference repository, and the task-2.1 pins
 * exercise the production D1 governance default on the same migrated
 * harness (seeded through the D1 repository's create()).
 *
 * @module IngestionProducerTest
 */

import { describe, it, expect } from 'vitest';
import {
  ingestionDedupeKey,
  intervalBucketFires,
  isMerchantPermitted,
  schedulePriceIngestions,
} from '../ingestion-producer';
import type { IngestionMessageBody } from '../ingestion-message';
import { InMemorySourceGovernanceRepository } from '../../../../../packages/application-api/src/ops/governance/in-memory-source-governance.repository';
import { D1SourceGovernanceRepository } from '../../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { composeMerchantRegistry } from '../pipeline';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';
import type { PermissionCheckResult } from '@rajahinta/core-domain';

const LOG = createLogger(undefined);

function createEnv(): { env: Env } {
  const { d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env };
}

async function seedMerchant(
  env: Env,
  merchantId: string,
  feedUrl: string | null,
  pollingIntervalMs = 3_600_000,
): Promise<void> {
  await composeMerchantRegistry(env).upsert({
    merchantId,
    name: `${merchantId} AB`,
    country: 'SE',
    feedUrl: feedUrl ?? '',
    feedFormat: 'json',
    pollingIntervalMs,
  });
}

function governanceRepo(
  grants: Record<string, 'GRANTED' | 'PENDING' | 'REVOKED'>,
): InMemorySourceGovernanceRepository {
  const repo = new InMemorySourceGovernanceRepository();
  for (const [merchantId, status] of Object.entries(grants)) {
    void repo.create({
      merchantId,
      acquisitionMethod: 'RETAILER_API',
      permissionStatus: status,
      sourceUrl: `https://${merchantId}.example/feed`,
    });
  }
  return repo;
}

function checkPermissionOf(
  repo: InMemorySourceGovernanceRepository,
): (merchantId: string) => Promise<PermissionCheckResult> {
  return (merchantId) => repo.checkPermission(merchantId);
}

describe('ingestionDedupeKey', () => {
  it('preserves the BullMQ jobId shape: price-ingestion-<merchantId>-<YYYY-MM-DD-HH> (UTC)', () => {
    expect(
      ingestionDedupeKey('alko', new Date('2026-08-30T14:05:00.000Z')),
    ).toBe('price-ingestion-alko-2026-08-30-14');
    expect(
      ingestionDedupeKey('eu-import', new Date('2026-01-01T00:30:00.000Z')),
    ).toBe('price-ingestion-eu-import-2026-01-01-00');
  });
});

describe('intervalBucketFires (cadence gate, task 1.1 / design D1)', () => {
  const HOUR = 3_600_000;
  const SIX_HOURS = 21_600_000;
  const DAY = 86_400_000;
  /** previousTick exactly as the producer derives it: now minus 1 h. */
  const previousTickOf = (now: Date): Date => new Date(now.getTime() - HOUR);

  it('fires an hourly merchant on every consecutive tick', () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 7, 30, h));
      expect(intervalBucketFires(HOUR, now, previousTickOf(now))).toBe(true);
    }
  });

  it('fires a daily merchant exactly once across 24 consecutive hourly ticks — the first tick at/after 00:00 UTC', () => {
    const firedHours: number[] = [];
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 7, 30, h));
      if (intervalBucketFires(DAY, now, previousTickOf(now))) {
        firedHours.push(h);
      }
    }
    expect(firedHours).toEqual([0]);
  });

  it('fires a 6 h merchant only at 00/06/12/18 UTC', () => {
    const firedHours: number[] = [];
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 7, 30, h));
      if (intervalBucketFires(SIX_HOURS, now, previousTickOf(now))) {
        firedHours.push(h);
      }
    }
    expect(firedHours).toEqual([0, 6, 12, 18]);
  });

  it('fires a tick exactly on an interval boundary', () => {
    expect(
      intervalBucketFires(
        DAY,
        new Date('2026-08-30T00:00:00.000Z'),
        new Date('2026-08-29T23:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      intervalBucketFires(
        SIX_HOURS,
        new Date('2026-08-30T06:00:00.000Z'),
        new Date('2026-08-30T05:00:00.000Z'),
      ),
    ).toBe(true);
    // A non-boundary tick between boundaries stays silent.
    expect(
      intervalBucketFires(
        DAY,
        new Date('2026-08-30T12:00:00.000Z'),
        new Date('2026-08-30T11:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('self-heals a missed boundary: previousTick two hours back spanning it still fires once on the next tick', () => {
    // The 00:00 UTC tick was missed entirely (worker outage); the 01:00
    // tick's previous tick (23:00) still lies before the day boundary,
    // so the bucket differs and the merchant fires.
    expect(
      intervalBucketFires(
        DAY,
        new Date('2026-08-30T01:00:00.000Z'),
        new Date('2026-08-29T23:00:00.000Z'),
      ),
    ).toBe(true);
  });
});

describe('isMerchantPermitted (scheduler gate parity)', () => {
  it('admits GRANTED merchants only', async () => {
    const repo = governanceRepo({ alko: 'GRANTED' });
    await expect(
      isMerchantPermitted(checkPermissionOf(repo), 'alko', LOG),
    ).resolves.toBe(true);
  });

  it('skips merchants with no governance records — default PENDING', async () => {
    const repo = governanceRepo({});
    await expect(
      isMerchantPermitted(checkPermissionOf(repo), 'alko', LOG),
    ).resolves.toBe(false);
  });

  it('skips non-GRANTED statuses', async () => {
    const repo = governanceRepo({
      alko: 'PENDING',
      'eu-import': 'REVOKED',
      beermax: 'EXPIRED' as never,
    });
    for (const merchantId of ['alko', 'eu-import', 'beermax']) {
      await expect(
        isMerchantPermitted(checkPermissionOf(repo), merchantId, LOG),
      ).resolves.toBe(false);
    }
  });

  it('fails closed when the governance check throws', async () => {
    await expect(
      isMerchantPermitted(
        () => Promise.reject(new Error('governance outage')),
        'alko',
        LOG,
      ),
    ).resolves.toBe(false);
  });
});

describe('schedulePriceIngestions', () => {
  it('enqueues exactly one message per GRANTED merchant with the dedupe key in the body', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'alko', 'https://alko.example/api');
    await seedMerchant(env, 'eu-import', 'https://sb.example/json');
    const sent: IngestionMessageBody[] = [];
    const queue = { send: async (body: IngestionMessageBody) => void sent.push(body) };

    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T14:00:00.000Z'),
      queue,
      checkPermission: checkPermissionOf(
        governanceRepo({ alko: 'GRANTED', 'eu-import': 'GRANTED' }),
      ),
    });

    expect(result).toEqual({
      merchants: 2,
      enqueued: 2,
      skippedNoFeedUrl: 0,
      skippedNotPermitted: 0,
      skippedNotDue: 0,
      enqueueErrors: 0,
    });
    expect([...sent].sort((a, b) => a.merchantId.localeCompare(b.merchantId))).toEqual([
      {
        dedupeKey: 'price-ingestion-alko-2026-08-30-14',
        merchantId: 'alko',
        sourceUrl: 'https://alko.example/api',
      },
      {
        dedupeKey: 'price-ingestion-eu-import-2026-08-30-14',
        merchantId: 'eu-import',
        sourceUrl: 'https://sb.example/json',
      },
    ]);
  });

  it('skips non-GRANTED merchants and merchants without a feed URL', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'granted', 'https://granted.example/feed');
    await seedMerchant(env, 'pending', 'https://pending.example/feed');
    // Empty feed URL is the registry convention for "adapter not live yet"
    // — skipped even when governance would grant it.
    await seedMerchant(env, 'nofeed', null);

    const sent: IngestionMessageBody[] = [];
    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T15:00:00.000Z'),
      queue: { send: async (body) => void sent.push(body) },
      checkPermission: checkPermissionOf(
        governanceRepo({ granted: 'GRANTED', pending: 'PENDING', nofeed: 'GRANTED' }),
      ),
    });

    expect(result.enqueued).toBe(1);
    expect(result.skippedNotPermitted).toBe(1);
    expect(result.skippedNoFeedUrl).toBe(1);
    expect(sent.map((m) => m.merchantId)).toEqual(['granted']);
  });

  it('isolates per-merchant enqueue failures — remaining merchants still enqueue', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'a-merchant', 'https://a.example/feed');
    await seedMerchant(env, 'b-merchant', 'https://b.example/feed');

    const sent: IngestionMessageBody[] = [];
    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T16:00:00.000Z'),
      queue: {
        send: async (body) => {
          if (body.merchantId === 'a-merchant') {
            throw new Error('queue unavailable');
          }
          sent.push(body);
        },
      },
      checkPermission: checkPermissionOf(
        governanceRepo({ 'a-merchant': 'GRANTED', 'b-merchant': 'GRANTED' }),
      ),
    });

    expect(result.enqueued).toBe(1);
    expect(result.enqueueErrors).toBe(1);
    expect(sent.map((m) => m.merchantId)).toEqual(['b-merchant']);
  });

  it('is registry-driven: a merchant granted in the registry needs no code change', async () => {
    const { env } = createEnv();
    // Only the new merchant exists — the next scheduling run picks it up.
    await seedMerchant(env, 'new-entrant', 'https://new.example/feed');

    const sent: IngestionMessageBody[] = [];
    await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T17:00:00.000Z'),
      queue: { send: async (body) => void sent.push(body) },
      checkPermission: checkPermissionOf(governanceRepo({ 'new-entrant': 'GRANTED' })),
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].dedupeKey).toBe('price-ingestion-new-entrant-2026-08-30-17');
  });
});

describe('schedulePriceIngestions — D1 governance default (task 2.1)', () => {
  // Neither test passes the checkPermission seam: the production default
  // (composeGovernanceService over D1SourceGovernanceRepository(env.DB))
  // is the code under test.
  it('fails closed on an empty source_governance table — every merchant skipped as not-permitted, zero enqueued', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'alko', 'https://alko.example/api');
    await seedMerchant(env, 'eu-import', 'https://sb.example/json');

    const sent: IngestionMessageBody[] = [];
    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T18:00:00.000Z'),
      queue: { send: async (body) => void sent.push(body) },
    });

    // The empty durable store aggregates to PENDING — identical to the
    // old in-memory default, nothing reaches the queue.
    expect(result).toEqual({
      merchants: 2,
      enqueued: 0,
      skippedNoFeedUrl: 0,
      skippedNotPermitted: 2,
      skippedNotDue: 0,
      enqueueErrors: 0,
    });
    expect(sent).toEqual([]);
  });

  it('enqueues a registry merchant from a GRANTED source_governance row — the console grant reaches the producer without a deploy', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'alko', 'https://alko.example/api');
    await new D1SourceGovernanceRepository(env.DB).create({
      merchantId: 'alko',
      acquisitionMethod: 'RETAILER_API',
      permissionStatus: 'GRANTED',
      sourceUrl: 'https://alko.example/api',
    });

    const sent: IngestionMessageBody[] = [];
    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T19:00:00.000Z'),
      queue: { send: async (body) => void sent.push(body) },
    });

    expect(result.enqueued).toBe(1);
    expect(result.skippedNotPermitted).toBe(0);
    expect(sent).toEqual([
      {
        dedupeKey: 'price-ingestion-alko-2026-08-30-19',
        merchantId: 'alko',
        sourceUrl: 'https://alko.example/api',
      },
    ]);
  });
});

describe('schedulePriceIngestions — interval cadence gate (task 1.1)', () => {
  it('enqueues hourly merchants every tick, 6 h merchants at 00/06/12/18, and daily merchants once per day', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'hourly', 'https://hourly.example/feed', 3_600_000);
    await seedMerchant(env, 'six-hourly', 'https://six.example/feed', 21_600_000);
    await seedMerchant(env, 'daily', 'https://daily.example/feed', 86_400_000);
    const grants = governanceRepo({
      hourly: 'GRANTED',
      'six-hourly': 'GRANTED',
      daily: 'GRANTED',
    });

    const sent: IngestionMessageBody[] = [];
    let skippedNotDue = 0;
    // 24 consecutive synthetic hourly ticks across one UTC day.
    for (let h = 0; h < 24; h++) {
      const result = await schedulePriceIngestions(env, {
        now: new Date(Date.UTC(2026, 7, 30, h)),
        queue: { send: async (body) => void sent.push(body) },
        checkPermission: checkPermissionOf(grants),
      });
      skippedNotDue += result.skippedNotDue;
    }

    const keysFor = (merchantId: string): string[] =>
      sent.filter((m) => m.merchantId === merchantId).map((m) => m.dedupeKey);
    expect(keysFor('hourly')).toHaveLength(24);
    expect(keysFor('six-hourly')).toEqual([
      'price-ingestion-six-hourly-2026-08-30-00',
      'price-ingestion-six-hourly-2026-08-30-06',
      'price-ingestion-six-hourly-2026-08-30-12',
      'price-ingestion-six-hourly-2026-08-30-18',
    ]);
    expect(keysFor('daily')).toEqual(['price-ingestion-daily-2026-08-30-00']);
    // Not-due skips: hourly 0, six-hourly 20, daily 23.
    expect(skippedNotDue).toBe(43);
  });

  it('keeps hourly-interval behavior unchanged: a permitted merchant enqueues on a mid-hour tick as before', async () => {
    const { env } = createEnv();
    await seedMerchant(env, 'alko', 'https://alko.example/api');

    const sent: IngestionMessageBody[] = [];
    const result = await schedulePriceIngestions(env, {
      now: new Date('2026-08-30T14:37:00.000Z'),
      queue: { send: async (body) => void sent.push(body) },
      checkPermission: checkPermissionOf(governanceRepo({ alko: 'GRANTED' })),
    });

    expect(result).toEqual({
      merchants: 1,
      enqueued: 1,
      skippedNoFeedUrl: 0,
      skippedNotPermitted: 0,
      skippedNotDue: 0,
      enqueueErrors: 0,
    });
    expect(sent).toEqual([
      {
        dedupeKey: 'price-ingestion-alko-2026-08-30-14',
        merchantId: 'alko',
        sourceUrl: 'https://alko.example/api',
      },
    ]);
  });
});

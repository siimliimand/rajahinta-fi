import { describe, it, expect } from 'vitest';
import type Redis from 'ioredis';
import type { ClickCounterSnapshotRepository } from '@rajahinta/data-platform';
import { RedisClickAnalyticsService } from '../redis-click-analytics.service';
import { ClickAnalyticsSnapshotService } from '../click-analytics-snapshot.service';

// ---------------------------------------------------------------------------
// Fakes — an in-memory Redis stand-in implementing the small command
// surface the services use (multi/hincrby/hset/exec, hgetall, scan), and
// a capturing snapshot repository.
// ---------------------------------------------------------------------------

function createFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();

  const hash = (key: string): Map<string, string> => {
    let entry = hashes.get(key);
    if (!entry) {
      entry = new Map();
      hashes.set(key, entry);
    }
    return entry;
  };

  return {
    hgetall: async (key: string): Promise<Record<string, string>> =>
      Object.fromEntries(hash(key)),
    scan: async (
      _cursor: string,
      _mode: 'MATCH',
      pattern: string,
      _count: 'COUNT',
      _n: string,
    ): Promise<[string, string[]]> => {
      const prefix = pattern.slice(0, -1); // strip trailing '*'
      return ['0', [...hashes.keys()].filter((k) => k.startsWith(prefix))];
    },
    multi() {
      const ops: Array<() => void> = [];
      const chain = {
        hincrby(key: string, field: string, inc: number) {
          ops.push(() => {
            const entry = hash(key);
            entry.set(field, String(Number(entry.get(field) ?? 0) + inc));
          });
          return chain;
        },
        hset(key: string, field: string, value: string) {
          ops.push(() => hash(key).set(field, value));
          return chain;
        },
        async exec() {
          for (const op of ops) op();
          return [];
        },
      };
      return chain;
    },
  };
}


type SnapshotRow = {
  merchantId: string;
  url: string;
  clickCount: number;
  capturedAt: Date;
};

class FakeSnapshotRepository implements ClickCounterSnapshotRepository {
  readonly batches: SnapshotRow[][] = [];

  async appendBatch(rows: SnapshotRow[]): Promise<number> {
    this.batches.push(rows);
    return rows.length;
  }
}

function makeService(redis: Redis | null = createFakeRedis() as unknown as Redis) {
  const clickAnalytics = new RedisClickAnalyticsService(redis);
  return { clickAnalytics };
}

describe('RedisClickAnalyticsService', () => {
  it('counts clicks per merchant and URL across calls', async () => {
    const { clickAnalytics } = makeService();
    const url = 'https://example.invalid/product';
    await clickAnalytics.recordClick('alko', url);
    await clickAnalytics.recordClick('alko', url);
    await clickAnalytics.recordClick('systembolaget', url);

    const counts = await clickAnalytics.getClickCounts();
    expect(counts.alko[url]).toBe(2);
    expect(counts.systembolaget[url]).toBe(1);
  });

  it('summarises stats with the Phase 1 zero-literal fields', async () => {
    const { clickAnalytics } = makeService();
    await clickAnalytics.recordClick('alko', 'https://example.invalid/a');
    await clickAnalytics.recordClick('alko', 'https://example.invalid/b');
    await clickAnalytics.recordClick('alko', 'https://example.invalid/b');

    const stats = await clickAnalytics.getClickStats();
    expect(stats.alko.totalClicks).toBe(3);
    expect(stats.alko.uniqueUrls).toBe(2);
    expect(stats.alko.purchaseCount).toBe(0);
    expect(stats.alko.commissionTotalCents).toBe(0);
  });

  it('degrades to empty data without a Redis client', async () => {
    const { clickAnalytics } = makeService(null);
    await expect(clickAnalytics.recordClick('alko', 'https://x.invalid')).resolves.toBeUndefined();
    await expect(clickAnalytics.getClickCounts()).resolves.toEqual({});
    await expect(clickAnalytics.listMerchants()).resolves.toEqual([]);
  });

  it('lists merchants deterministically', async () => {
    const { clickAnalytics } = makeService();
    await clickAnalytics.recordClick('systembolaget', 'https://x.invalid');
    await clickAnalytics.recordClick('alko', 'https://x.invalid');
    await expect(clickAnalytics.listMerchants()).resolves.toEqual([
      'alko',
      'systembolaget',
    ]);
  });
});

describe('ClickAnalyticsSnapshotService', () => {
  it('archives one row per merchant URL with a shared capture instant', async () => {
    const redis = createFakeRedis() as unknown as Redis;
    const clickAnalytics = new RedisClickAnalyticsService(redis);
    await clickAnalytics.recordClick('alko', 'https://example.invalid/a');
    await clickAnalytics.recordClick('alko', 'https://example.invalid/a');
    await clickAnalytics.recordClick('alko', 'https://example.invalid/b');

    const snapshots = new FakeSnapshotRepository();
    const service = new ClickAnalyticsSnapshotService(clickAnalytics, snapshots);

    const at = new Date('2026-08-28T06:00:00.000Z');
    const written = await service.snapshotNow(at);

    expect(written).toBe(2);
    expect(snapshots.batches).toHaveLength(1);
    const batch = snapshots.batches[0];
    const byUrl = Object.fromEntries(batch.map((r) => [r.url, r]));
    expect(byUrl['https://example.invalid/a'].clickCount).toBe(2);
    expect(byUrl['https://example.invalid/b'].clickCount).toBe(1);
    for (const row of batch) {
      expect(row.capturedAt).toBe(at);
      expect(row.merchantId).toBe('alko');
    }
  });

  it('writes nothing when no counters exist', async () => {
    const redis = createFakeRedis() as unknown as Redis;
    const clickAnalytics = new RedisClickAnalyticsService(redis);
    const snapshots = new FakeSnapshotRepository();
    const service = new ClickAnalyticsSnapshotService(clickAnalytics, snapshots);

    await expect(service.snapshotNow()).resolves.toBe(0);
    expect(snapshots.batches).toHaveLength(0);
  });
});

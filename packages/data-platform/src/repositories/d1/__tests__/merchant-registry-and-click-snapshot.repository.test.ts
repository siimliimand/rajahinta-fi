/**
 * D1MerchantRegistryRepository + D1ClickCounterSnapshotRepository —
 * real-SQLite tests (task 2.5), mirroring the pg test file's pairing:
 * deterministic registry listing and upsert-on-merchantId; snapshot
 * batch upserts converging on the (merchant, url, capturedAt) key.
 *
 * @module D1MerchantRegistryAndClickSnapshotRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1MerchantRegistryRepository } from '../merchant-registry.repository';
import { D1ClickCounterSnapshotRepository } from '../click-counter-snapshot.repository';

const { d1 } = openMigratedD1();
const registry = new D1MerchantRegistryRepository(d1);
const snapshots = new D1ClickCounterSnapshotRepository(d1);

const CAPTURED_AT = new Date('2026-08-28T06:00:00.000Z');

describe('D1MerchantRegistryRepository', () => {
  it('lists the registry deterministically by merchantId', async () => {
    await registry.upsert({ merchantId: 'systembolaget', name: 'Systembolaget', country: 'SE', feedUrl: 'https://systembolaget.se/feed', feedFormat: 'json', pollingIntervalMs: 3_600_000 });
    await registry.upsert({ merchantId: 'alko', name: 'Alko', country: 'FI', feedUrl: '', feedFormat: 'json', pollingIntervalMs: 3_600_000 });

    const listed = await registry.list();
    expect(listed.map((r) => r.merchantId)).toEqual(['alko', 'systembolaget']);
  });

  it('upserts on the merchantId unique key and refreshes updatedAt', async () => {
    const original = await registry.upsert({
      merchantId: 'beermax',
      name: 'Beermax',
      country: 'EE',
      feedUrl: 'https://beermax.ee/feed.json',
      feedFormat: 'json',
      pollingIntervalMs: 1_800_000,
    });

    const updated = await registry.upsert({
      merchantId: 'beermax',
      name: 'Beermax OÜ',
      country: 'EE',
      feedUrl: 'https://beermax.ee/v2/feed.json',
      feedFormat: 'json',
      pollingIntervalMs: 900_000,
    });

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe('Beermax OÜ');
    expect(updated.pollingIntervalMs).toBe(900_000);
    expect(updated.createdAt).toEqual(original.createdAt);
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());

    const rows = (await d1
      .prepare('SELECT count(*) AS n FROM merchant_registry WHERE merchant_id = ?')
      .bind('beermax')
      .first()) as { n: number };
    expect(rows.n).toBe(1);
  });

  it('finds a registry row by merchantId; unknown ids are null', async () => {
    expect(await registry.findByMerchantId('beermax')).not.toBeNull();
    await expect(registry.findByMerchantId('nope')).resolves.toBeNull();
  });
});

describe('D1ClickCounterSnapshotRepository', () => {
  it('writes a batch and reports the written count', async () => {
    const written = await snapshots.appendBatch([
      { merchantId: 'alko', url: 'https://alko.fi/product/1', clickCount: 12, capturedAt: CAPTURED_AT },
      { merchantId: 'alko', url: 'https://alko.fi/product/2', clickCount: 3, capturedAt: CAPTURED_AT },
    ]);
    expect(written).toBe(2);

    const rows = (await d1
      .prepare('SELECT merchant_id, url, click_count FROM click_counter_snapshots ORDER BY url')
      .all()) as unknown as { results: { merchant_id: string; url: string; click_count: number }[] };
    expect(rows.results.map((r) => [r.merchant_id, r.click_count])).toEqual([
      ['alko', 12],
      ['alko', 3],
    ]);
  });

  it('converges on the (merchant, url, capturedAt) key — the fresh count wins', async () => {
    await snapshots.appendBatch([
      { merchantId: 'beermax', url: 'https://beermax.ee/p/1', clickCount: 5, capturedAt: CAPTURED_AT },
    ]);
    const written = await snapshots.appendBatch([
      { merchantId: 'beermax', url: 'https://beermax.ee/p/1', clickCount: 9, capturedAt: CAPTURED_AT },
    ]);
    expect(written).toBe(1);

    const row = (await d1
      .prepare('SELECT click_count FROM click_counter_snapshots WHERE merchant_id = ?')
      .bind('beermax')
      .first()) as { click_count: number };
    expect(row.click_count).toBe(9);
  });

  it('writes nothing for an empty batch', async () => {
    await expect(snapshots.appendBatch([])).resolves.toBe(0);
  });

  it('defaults capturedAt to the current instant when a row omits it', async () => {
    const before = new Date();
    await snapshots.appendBatch([
      { merchantId: 'posti', url: 'https://posti.fi/link', clickCount: 1 },
    ]);
    const row = (await d1
      .prepare("SELECT captured_at FROM click_counter_snapshots WHERE merchant_id = 'posti'")
      .first()) as { captured_at: string };
    expect(new Date(row.captured_at).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

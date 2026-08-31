/**
 * ClickCounterDO tests (task 3.4).
 *
 * Expectations ported from the counter semantics being replaced:
 * `packages/application-api/src/analytics/__tests__/` (in-memory
 * ClickAnalyticsService: per-(merchant, url) dimensions, cumulative
 * counts, getClickCounts shape) and
 * `packages/application-api/src/audit/__tests__/redis-click-analytics.service.test.ts`
 * (durable exact increments). The flush/alarm half mirrors the
 * ClickAnalyticsSnapshotService cron semantics: payloads carry
 * cumulative totals, deltas drain, captures happen even with no
 * traffic. The DO runs against the in-memory storage emulating
 * DurableObjectStorage; time is pinned per request via `nowMs`.
 *
 * @module ClickCounterDoTest
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FLUSH_INTERVAL_MS,
  ClickCounterDO,
} from '../click-counter.do';
import type { ClickCounterSnapshot } from '../click-counter.do';
import {
  callDo,
  callDoRaw,
  createMemoryDoState,
  createMemoryDoStorage,
  fireAlarm,
  type MemoryDoStorage,
} from './memory-do-storage';

/** Fixed epoch so alarm math reads as absolute times. */
const T0 = 1_710_000_000_000;

interface IncrementResponse {
  total: number;
}
interface CountsResponse {
  counts: Record<string, Record<string, number>>;
}
interface DrainResponse {
  snapshot: ClickCounterSnapshot | null;
}

function createDo(): { instance: ClickCounterDO; storage: MemoryDoStorage } {
  const storage = createMemoryDoStorage();
  return { instance: new ClickCounterDO(createMemoryDoState(storage), {}), storage };
}

async function increment(
  instance: ClickCounterDO,
  merchantId: string,
  url: string,
  extra: { by?: number; flushIntervalMs?: number; nowMs?: number } = {},
): Promise<number> {
  const { total } = await callDo<IncrementResponse>(instance, {
    op: 'increment',
    merchantId,
    url,
    ...extra,
  });
  return total;
}

async function drain(
  instance: ClickCounterDO,
  nowMs?: number,
): Promise<ClickCounterSnapshot | null> {
  const { snapshot } = await callDo<DrainResponse>(instance, {
    op: 'drain',
    ...(nowMs !== undefined ? { nowMs } : {}),
  });
  return snapshot;
}

/** Increment several pairs in one go; keys are [merchantId, url]. */
async function seedClicks(
  instance: ClickCounterDO,
  clicks: [string, string, number?][],
  nowMs = T0,
): Promise<void> {
  for (const [merchantId, url, by] of clicks) {
    await increment(instance, merchantId, url, { ...(by !== undefined ? { by } : {}), nowMs });
  }
}

describe('ClickCounterDO — increment exactness', () => {
  it('defaults to +1 and accumulates exactly', async () => {
    const { instance } = createDo();
    expect(await increment(instance, 'alko', 'https://alko.fi/p/1', { nowMs: T0 })).toBe(1);
    expect(await increment(instance, 'alko', 'https://alko.fi/p/1', { nowMs: T0 })).toBe(2);
    expect(await increment(instance, 'alko', 'https://alko.fi/p/1', { nowMs: T0 })).toBe(3);
  });

  it('increments by an explicit positive integer amount', async () => {
    const { instance } = createDo();
    expect(await increment(instance, 'alko', 'u', { by: 5, nowMs: T0 })).toBe(5);
    expect(await increment(instance, 'alko', 'u', { by: 2, nowMs: T0 })).toBe(7);
  });

  it('isolates pairs — same merchant other url, other merchant same url', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [
      ['alko', 'https://alko.fi/p/1', 3],
      ['alko', 'https://alko.fi/p/2', 1],
      ['systembolaget', 'https://alko.fi/p/1', 2],
    ], T0);

    const { counts } = await callDo<CountsResponse>(instance, { op: 'counts' });
    expect(counts).toEqual({
      alko: { 'https://alko.fi/p/1': 3, 'https://alko.fi/p/2': 1 },
      systembolaget: { 'https://alko.fi/p/1': 2 },
    });
  });

  it('keeps full URLs distinct — no hashing, reverse-map-free', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [
      ['alko', 'https://alko.fi/p/1?utm=a', 1],
      ['alko', 'https://alko.fi/p/1?utm=b', 1],
      ['alko', 'https://alko.fi/p/1#frag', 1],
    ], T0);

    const { counts } = await callDo<CountsResponse>(instance, { op: 'counts' });
    expect(Object.keys(counts.alko)).toHaveLength(3);
  });

  it('rejects invalid increments with the 400 envelope', async () => {
    const { instance } = createDo();
    for (const body of [
      { op: 'increment', merchantId: 'alko', url: 'u', by: 0 },
      { op: 'increment', merchantId: 'alko', url: 'u', by: -1 },
      { op: 'increment', merchantId: 'alko', url: 'u', by: 1.5 },
      { op: 'increment', merchantId: '', url: 'u' },
      { op: 'increment', merchantId: 'alko', url: '' },
      { op: 'increment', merchantId: 'alko', url: 'u', flushIntervalMs: 0 },
      { op: 'nope' },
    ]) {
      const response = await callDoRaw(instance, body);
      expect(response.status).toBe(400);
    }
    const invalidJson = await instance.fetch(
      new Request('https://do.internal/', { method: 'POST', body: 'not json' }),
    );
    expect(invalidJson.status).toBe(400);
  });
});

describe('ClickCounterDO — key-dimension parity (ClickAnalyticsService)', () => {
  it('reports the same nested Record<merchant, Record<url, count>> shape as getClickCounts', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [
      ['alko', 'https://alko.fi/product/1', 12],
      ['alko', 'https://alko.fi/product/2', 3],
      ['beermax', 'https://beermax.ee/p/1', 7],
    ], T0);

    const { counts } = await callDo<CountsResponse>(instance, { op: 'counts' });
    expect(counts).toEqual({
      alko: { 'https://alko.fi/product/1': 12, 'https://alko.fi/product/2': 3 },
      beermax: { 'https://beermax.ee/p/1': 7 },
    });
  });

  it('returns an empty record when nothing was clicked', async () => {
    const { instance } = createDo();
    const { counts } = await callDo<CountsResponse>(instance, { op: 'counts' });
    expect(counts).toEqual({});
  });
});

describe('ClickCounterDO — drain-empties semantics', () => {
  it('returns null when nothing was clicked since the last capture', async () => {
    const { instance } = createDo();
    await expect(drain(instance, T0)).resolves.toBeNull();
  });

  it('returns cumulative totals per pair at the capture instant, sorted deterministically', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [
      ['alko', 'https://alko.fi/p/2', 3],
      ['alko', 'https://alko.fi/p/1', 1],
      ['systembolaget', 'https://systembolaget.se/p', 2],
    ], T0);

    const snapshot = await drain(instance, T0 + 1_000);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.capturedAt).toBe(new Date(T0 + 1_000).toISOString());
    expect(snapshot!.rows).toEqual([
      { merchantId: 'alko', url: 'https://alko.fi/p/1', clickCount: 1 },
      { merchantId: 'alko', url: 'https://alko.fi/p/2', clickCount: 3 },
      { merchantId: 'systembolaget', url: 'https://systembolaget.se/p', clickCount: 2 },
    ]);
  });

  it('empties on drain — a second drain returns null', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [['alko', 'u1', 2]], T0);
    expect(await drain(instance, T0 + 1_000)).not.toBeNull();
    await expect(drain(instance, T0 + 2_000)).resolves.toBeNull();
  });

  it('totals survive the drain — cumulative archive, not resettable counters', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [['alko', 'u1', 4]], T0);
    await drain(instance, T0 + 1_000);

    const { counts } = await callDo<CountsResponse>(instance, { op: 'counts' });
    expect(counts).toEqual({ alko: { u1: 4 } });
  });

  it('the next capture only covers pairs clicked since the last one, carrying their new cumulative totals', async () => {
    const { instance } = createDo();
    await seedClicks(instance, [
      ['alko', 'u1', 1],
      ['alko', 'u2', 2],
    ], T0);
    await drain(instance, T0 + 1_000);

    // Only u1 is clicked again.
    await increment(instance, 'alko', 'u1', { by: 2, nowMs: T0 + 2_000 });
    const snapshot = await drain(instance, T0 + 3_000);
    expect(snapshot!.rows).toEqual([{ merchantId: 'alko', url: 'u1', clickCount: 3 }]);
  });

  it('ignores unknown extra fields on a valid op', async () => {
    const { instance } = createDo();
    const response = await callDoRaw(instance, { op: 'drain', bogus: true });
    expect(response.status).toBe(200);
  });
});

describe('ClickCounterDO — alarm-driven flush', () => {
  it('arms the alarm one default interval out on the first increment', async () => {
    const { instance, storage } = createDo();
    await increment(instance, 'alko', 'u1', { nowMs: T0 });
    await expect(storage.getAlarm()).resolves.toBe(T0 + DEFAULT_FLUSH_INTERVAL_MS);
  });

  it('honors an explicit flushIntervalMs and never postpones an armed alarm', async () => {
    const { instance, storage } = createDo();
    await increment(instance, 'alko', 'u1', { flushIntervalMs: 5_000, nowMs: T0 });
    await expect(storage.getAlarm()).resolves.toBe(T0 + 5_000);

    // Later increments (even default-interval ones) leave the armed alarm alone.
    await increment(instance, 'alko', 'u2', { nowMs: T0 + 1_000 });
    await expect(storage.getAlarm()).resolves.toBe(T0 + 5_000);
  });

  it('on fire: reschedules one persisted interval out and produces the pending payload', async () => {
    const { instance, storage } = createDo();
    await increment(instance, 'alko', 'u1', { by: 3, flushIntervalMs: 60_000, nowMs: T0 });
    await increment(instance, 'alko', 'u2', { nowMs: T0 });

    const before = Date.now();
    await fireAlarm(storage, instance);

    const rearmed = await storage.getAlarm();
    expect(rearmed).toBeGreaterThanOrEqual(before + 60_000);
    expect(rearmed).toBeLessThanOrEqual(Date.now() + 60_000);

    // Payload produced, deltas drained: first drain carries the rows, second is empty.
    const snapshot = await drain(instance);
    expect(snapshot!.rows).toEqual([
      { merchantId: 'alko', url: 'u1', clickCount: 3 },
      { merchantId: 'alko', url: 'u2', clickCount: 1 },
    ]);
    await expect(drain(instance)).resolves.toBeNull();
  });

  it('repeated alarms without a flusher keep one monotonic pending payload', async () => {
    const { instance, storage } = createDo();
    await increment(instance, 'alko', 'u1', { nowMs: T0 });
    await fireAlarm(storage, instance);

    await increment(instance, 'alko', 'u1', { nowMs: T0 + 1_000 });
    await increment(instance, 'alko', 'u2', { nowMs: T0 + 1_000 });
    await fireAlarm(storage, instance);

    const snapshot = await drain(instance);
    expect(snapshot!.rows).toEqual([
      { merchantId: 'alko', url: 'u1', clickCount: 2 },
      { merchantId: 'alko', url: 'u2', clickCount: 1 },
    ]);
  });

  it('captures even with zero traffic between ticks — an idle alarm still reschedules', async () => {
    const { instance, storage } = createDo();
    await increment(instance, 'alko', 'u1', { nowMs: T0 });
    await drain(instance, T0 + 1_000); // flusher took the payload

    const before = Date.now();
    await fireAlarm(storage, instance); // nothing new since
    const rearmed = await storage.getAlarm();
    expect(rearmed).toBeGreaterThanOrEqual(before + DEFAULT_FLUSH_INTERVAL_MS);
    await expect(drain(instance)).resolves.toBeNull();
  });
});

describe('ClickCounterDO — restart safety', () => {
  it('a fresh instance over the same storage sees persisted counters, alarm, and pending payload', async () => {
    const storage = createMemoryDoStorage();
    const first = new ClickCounterDO(createMemoryDoState(storage), {});
    await seedClicks(first, [['alko', 'u1', 2]], T0);
    await fireAlarm(storage, first); // payload pending in storage
    const armedAt = await storage.getAlarm();

    // Eviction/restart: a brand-new instance bound to the same storage.
    const second = new ClickCounterDO(createMemoryDoState(storage), {});
    const { counts } = await callDo<CountsResponse>(second, { op: 'counts' });
    expect(counts).toEqual({ alko: { u1: 2 } });
    await expect(storage.getAlarm()).resolves.toBe(armedAt);

    // Continued increments accumulate on the persisted totals.
    await increment(second, 'alko', 'u1', { nowMs: T0 + 1_000 });
    const snapshot = await drain(second);
    expect(snapshot!.rows).toEqual([{ merchantId: 'alko', url: 'u1', clickCount: 3 }]);
  });
});

/**
 * Click-counter flush → D1 integration tests (task 3.4).
 *
 * The full production path against the real committed D1 schema:
 * ClickCounterDO (in-memory storage emulation) → client stubs →
 * flushClickCounters → D1ClickCounterSnapshotRepository → the
 * `click_counter_snapshots` table over the fake-D1 harness (node:sqlite
 * + committed migrations). Assertions follow the repository suite's
 * expectations (cumulative counts, upsert convergence on the
 * (merchant, url, capturedAt) key) and the legacy cron snapshot's
 * archive semantics.
 *
 * @module ClickCounterFlusherTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { flushClickCounters } from '../click-counter-flusher';
import { getClickCounts, recordClick } from '../../do/client';
import { ClickCounterDO } from '../../do/click-counter.do';
import {
  createMemoryDoState,
  createMemoryDoStorage,
} from '../../do/__tests__/memory-do-storage';
import { openMigratedD1 } from './fake-d1';
import type { Env } from '../../env';

/** Fake DO namespace binding one real ClickCounterDO instance. */
function fakeNamespace(instance: ClickCounterDO): DurableObjectNamespace {
  const stub = {
    fetch: (request: Request) => instance.fetch(request),
  };
  return {
    idFromName: (name: string) => ({ name }),
    get: () => stub as unknown as DurableObjectStub,
  } as unknown as DurableObjectNamespace;
}

function createEnv(): {
  env: Env;
  instance: ClickCounterDO;
  db: DatabaseSync;
} {
  const storage = createMemoryDoStorage();
  const instance = new ClickCounterDO(createMemoryDoState(storage), {});
  const { db, d1 } = openMigratedD1();
  const env = {
    CLICK_COUNTER: fakeNamespace(instance),
    DB: d1,
  } as unknown as Env;
  return { env, instance, db };
}

async function snapshotRows(db: DatabaseSync): Promise<
  { merchant_id: string; url: string; click_count: number; captured_at: string }[]
> {
  // Raw node:sqlite statement — .all() resolves to the row array directly.
  return db
    .prepare(
      'SELECT merchant_id, url, click_count, captured_at FROM click_counter_snapshots ' +
        'ORDER BY captured_at, merchant_id, url',
    )
    .all() as unknown as {
    merchant_id: string;
    url: string;
    click_count: number;
    captured_at: string;
  }[];
}

describe('flushClickCounters → click_counter_snapshots (D1)', () => {
  it('is a no-op when nothing was clicked — no rows, no snapshot taken', async () => {
    const { env, db } = createEnv();
    const result = await flushClickCounters(env);
    expect(result).toEqual({ snapshotTaken: false, rowsWritten: 0 });
    expect(await snapshotRows(db)).toEqual([]);
  });

  it('writes the drained snapshot with cumulative counts at the capture instant', async () => {
    const { env, db } = createEnv();
    await recordClick(env, 'alko', 'https://alko.fi/product/1');
    await recordClick(env, 'alko', 'https://alko.fi/product/1');
    await recordClick(env, 'alko', 'https://alko.fi/product/2');
    await recordClick(env, 'beermax', 'https://beermax.ee/p/1', { by: 7 });

    const result = await flushClickCounters(env);
    expect(result).toEqual({ snapshotTaken: true, rowsWritten: 3 });

    const rows = await snapshotRows(db);
    expect(rows.map((r) => [r.merchant_id, r.url, r.click_count])).toEqual([
      ['alko', 'https://alko.fi/product/1', 2],
      ['alko', 'https://alko.fi/product/2', 1],
      ['beermax', 'https://beermax.ee/p/1', 7],
    ]);
    // Every row carries the capture instant, as a valid ISO-8601 UTC string.
    const instants = [...new Set(rows.map((r) => r.captured_at))];
    expect(instants).toHaveLength(1);
    expect(new Date(instants[0]).toISOString()).toBe(instants[0]);
  });

  it('archives cumulative intervals — later flushes carry grown totals at new instants', async () => {
    const { env, instance, db } = createEnv();
    await recordClick(env, 'alko', 'u1', { by: 2 });
    await flushClickCounters(env);

    // Traffic + an alarm tick, then a later flush.
    await recordClick(env, 'alko', 'u1', { by: 3 });
    await instance.alarm();
    await flushClickCounters(env);

    const rows = await snapshotRows(db);
    expect(rows.map((r) => [r.captured_at, r.click_count])).toEqual([
      [rows[0].captured_at, 2],
      [rows[1].captured_at, 5],
    ]);
    expect(rows[1].captured_at > rows[0].captured_at).toBe(true);

    // No traffic since → a third flush is a no-op (no duplicate archive rows).
    const result = await flushClickCounters(env);
    expect(result).toEqual({ snapshotTaken: false, rowsWritten: 0 });
    expect(await snapshotRows(db)).toHaveLength(2);
  });

  it('drain-empties through the flush path — nothing re-archives on the next flush', async () => {
    const { env, db } = createEnv();
    await recordClick(env, 'alko', 'u1', { by: 4 });
    await flushClickCounters(env);
    const second = await flushClickCounters(env);
    expect(second).toEqual({ snapshotTaken: false, rowsWritten: 0 });
    expect(await snapshotRows(db)).toHaveLength(1);
  });

  it('client stubs agree with the DO — getClickCounts mirrors the legacy service shape', async () => {
    const { env } = createEnv();
    await recordClick(env, 'alko', 'https://alko.fi/product/1');
    await recordClick(env, 'alko', 'https://alko.fi/product/2', { by: 5 });
    await expect(getClickCounts(env)).resolves.toEqual({
      alko: { 'https://alko.fi/product/1': 1, 'https://alko.fi/product/2': 5 },
    });
  });
});

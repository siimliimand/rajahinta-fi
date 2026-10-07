/**
 * D1CrawlWatermarkStore tests (task 3.1, change sitemap-crawl-merchants)
 * against the committed `aggregation_watermarks` DDL (node:sqlite +
 * structural D1 shim — the established fake-D1 pattern).
 *
 * The store's SQL surface is exactly one table, so the harness applies
 * the committed migration statements that define it (0000's
 * `aggregation_watermarks` CREATE TABLE + UNIQUE job_name index)
 * verbatim and skips the rest — the FTS5 product-search module is
 * unavailable in some Node builds these node:sqlite harnesses run on,
 * and its downstream sync triggers reference tables this store never
 * touches.
 *
 * Pins: lastmod-map and cursor round trips, the job-scoped row
 * namespaces (the watermark-isolation rule — own row only, never a
 * table-wide read, sibling jobs' rows untouched), and the shape-check
 * contract: an unusable persisted value reads as ABSENT (null → full
 * re-crawl / fresh discovery), never as a partially decoded state.
 *
 * @module D1CrawlWatermarkStoreTest
 */
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { createD1Shim } from '../../../../../packages/data-platform/src/repositories/d1/__tests__/d1-test-harness';
import {
  CRAWL_CURSOR_JOB_PREFIX,
  CRAWL_LASTMOD_JOB_PREFIX,
  D1CrawlWatermarkStore,
  crawlCursorJobName,
  crawlLastmodJobName,
} from '../d1-crawl-watermark.store';

function migrationsDir(): string {
  return new URL(
    '../../../../../packages/data-platform/src/d1/migrations',
    import.meta.url,
  ).pathname;
}

/**
 * Fresh in-memory database carrying exactly the committed DDL of the
 * one table the store touches (see module header).
 */
function openStore(): { db: DatabaseSync; store: D1CrawlWatermarkStore } {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(`${migrationsDir()}/${file}`, 'utf8').split(
      '--> statement-breakpoint',
    )) {
      if (statement.trim().length === 0) continue;
      if (!statement.includes('aggregation_watermarks')) continue;
      db.exec(statement);
    }
  }
  return { db, store: new D1CrawlWatermarkStore(createD1Shim(db)) };
}

function seedForeignJobRows(db: DatabaseSync): void {
  // The two sibling jobs that share aggregation_watermarks: an ISO
  // instant (time-series) and a numeric cursor (the '9194'-shaped
  // savings row) — the exact shadowing pair the isolation rule exists
  // for.
  const insert = db.prepare(
    `INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
     VALUES (?, ?, ?)`,
  );
  insert.run('time-series-aggregation', '2026-10-07T00:00:00.000Z', '2026-10-07T00:00:00.000Z');
  insert.run('savings-snapshot-cursor', '9194', '2026-10-07T00:00:00.000Z');
}

function rawRow(db: DatabaseSync, jobName: string): string | null {
  const row = db
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .get(jobName) as { watermark: string } | undefined;
  return row?.watermark ?? null;
}

describe('row namespaces', () => {
  it('per-merchant job names are prefixed and collision-free with sibling jobs', () => {
    expect(crawlLastmodJobName('licorea')).toBe('sitemap-crawl-lastmod-licorea');
    expect(crawlCursorJobName('licorea')).toBe('sitemap-crawl-cursor-licorea');
    expect(CRAWL_LASTMOD_JOB_PREFIX).not.toBe(CRAWL_CURSOR_JOB_PREFIX);
  });
});

describe('lastmod watermark (ILastmodWatermarkStore)', () => {
  it('round-trips a loc → lastmod|null map', async () => {
    const { db, store } = openStore();
    seedForeignJobRows(db);

    expect(await store.load('licorea')).toBeNull(); // never crawled

    await store.save(
      'licorea',
      new Map([
        ['https://www.licorea.com/a-en-p-1.html', '2026-09-30'],
        ['https://www.licorea.com/b-en-p-2.html', null],
      ]),
    );

    expect(await store.load('licorea')).toEqual(
      new Map([
        ['https://www.licorea.com/a-en-p-1.html', '2026-09-30'],
        ['https://www.licorea.com/b-en-p-2.html', null],
      ]),
    );
    // One JSON row on the merchant's own job_name.
    expect(rawRow(db, 'sitemap-crawl-lastmod-licorea')).toBe(
      JSON.stringify({
        'https://www.licorea.com/a-en-p-1.html': '2026-09-30',
        'https://www.licorea.com/b-en-p-2.html': null,
      }),
    );
  });

  it('save is an upsert on the job_name key — never a second row', async () => {
    const { db, store } = openStore();

    await store.save('licorea', new Map([['a', '2026-09-30']]));
    await store.save('licorea', new Map([['a', '2026-10-01']]));

    expect(await store.load('licorea')).toEqual(new Map([['a', '2026-10-01']]));
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM aggregation_watermarks WHERE job_name LIKE 'sitemap-crawl-lastmod-%'",
      )
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('foreign rows never leak in and are never disturbed', async () => {
    const { db, store } = openStore();
    seedForeignJobRows(db);

    // The merchant's own read stays absent despite the sibling rows.
    expect(await store.load('licorea')).toBeNull();

    await store.save('licorea', new Map([['a', '2026-09-30']]));

    expect(rawRow(db, 'time-series-aggregation')).toBe('2026-10-07T00:00:00.000Z');
    expect(rawRow(db, 'savings-snapshot-cursor')).toBe('9194');
  });

  it('shape-checks: garbage, wrong semantics, or arrays read as absent', async () => {
    const { db, store } = openStore();
    const write = db.prepare(
      'INSERT INTO aggregation_watermarks (job_name, watermark, updated_at) VALUES (?, ?, ?)',
    );
    write.run('sitemap-crawl-lastmod-licorea', 'not json at all', '2026-10-07T00:00:00.000Z');
    write.run('sitemap-crawl-lastmod-viinikauppa', '9194', '2026-10-07T00:00:00.000Z');
    write.run('sitemap-crawl-lastmod-drinkonline', '["a","b"]', '2026-10-07T00:00:00.000Z');
    write.run(
      'sitemap-crawl-lastmod-viinarannasta',
      JSON.stringify({ a: 42 }),
      '2026-10-07T00:00:00.000Z',
    );

    expect(await store.load('licorea')).toBeNull();
    expect(await store.load('viinikauppa')).toBeNull();
    expect(await store.load('drinkonline')).toBeNull();
    expect(await store.load('viinarannasta')).toBeNull();
  });
});

describe('crawl cursor (ICrawlCursorStore)', () => {
  it('round-trips queue + offset and clears', async () => {
    const { db, store } = openStore();
    const queue = ['https://example.com/p-1.html', 'https://example.com/p-2.html'];

    expect(await store.loadCursor('licorea')).toBeNull(); // no cycle in flight

    await store.saveCursor('licorea', { queue, offset: 1 });
    expect(await store.loadCursor('licorea')).toEqual({ queue, offset: 1 });

    await store.clearCursor('licorea');
    expect(await store.loadCursor('licorea')).toBeNull();
    // Clearing is idempotent and only touches the cursor row.
    await store.clearCursor('licorea');
    expect(rawRow(db, 'sitemap-crawl-lastmod-licorea')).toBeNull();
  });

  it('cursor rows are separate from lastmod rows per merchant', async () => {
    const { db, store } = openStore();

    await store.save('licorea', new Map([['a', null]]));
    await store.saveCursor('licorea', { queue: ['a'], offset: 0 });

    expect(await store.load('licorea')).toEqual(new Map([['a', null]]));
    expect(await store.loadCursor('licorea')).toEqual({ queue: ['a'], offset: 0 });

    // Draining the cycle clears ONLY the cursor row.
    await store.clearCursor('licorea');
    expect(await store.load('licorea')).toEqual(new Map([['a', null]]));

    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM aggregation_watermarks WHERE job_name LIKE 'sitemap-crawl-%'",
      )
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('shape-checks: corrupt cursors read as "no cycle in flight"', async () => {
    const { db, store } = openStore();
    const write = db.prepare(
      'INSERT INTO aggregation_watermarks (job_name, watermark, updated_at) VALUES (?, ?, ?)',
    );
    write.run('sitemap-crawl-cursor-licorea', '{{{', '2026-10-07T00:00:00.000Z');
    write.run(
      'sitemap-crawl-cursor-viinikauppa',
      JSON.stringify({ queue: ['a'], offset: -1 }),
      '2026-10-07T00:00:00.000Z',
    );
    write.run(
      'sitemap-crawl-cursor-drinkonline',
      JSON.stringify({ queue: ['a'], offset: 5 }),
      '2026-10-07T00:00:00.000Z',
    );
    write.run(
      'sitemap-crawl-cursor-viinarannasta',
      JSON.stringify({ queue: ['a', 7], offset: 0 }),
      '2026-10-07T00:00:00.000Z',
    );

    expect(await store.loadCursor('licorea')).toBeNull();
    expect(await store.loadCursor('viinikauppa')).toBeNull();
    expect(await store.loadCursor('drinkonline')).toBeNull();
    expect(await store.loadCursor('viinarannasta')).toBeNull();
  });
});

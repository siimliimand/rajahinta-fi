/**
 * Sitemap-crawl watermark resume on D1 (task 4.1, change
 * sitemap-crawl-merchants) — integration evidence for the incremental-sync
 * requirement and design D5: the chunked, resumable crawl cycle driven
 * through the real `LicoreaFeedAdapter` / `DrinkonlineFeedAdapter`
 * compositions over the durable `D1CrawlWatermarkStore`, on a fully
 * migrated database (node:sqlite harness, committed migrations applied).
 *
 * What this suite pins, and where the unit suites stop:
 *
 * - A cycle begin persists the lastmod map AND the in-flight cursor as
 *   `aggregation_watermarks` rows (`sitemap-crawl-lastmod-<merchantId>` /
 *   `sitemap-crawl-cursor-<merchantId>`); the rows carry exactly the
 *   product-URL set — image and CMS locs never enter the watermark
 *   (spec: "Sitemap contains non-product locs", filter before the diff).
 * - Resume across invocations: a fresh adapter + fresh store over the
 *   SAME database resumes the persisted cursor — no sitemap re-fetch, no
 *   re-fetch of the advanced prefix (spec: state "persisted per merchant
 *   and resumable across invocations"). The store unit test proves the
 *   JSON round trip; only a second composed invocation over the same
 *   storage proves the walk actually continues from it.
 * - Crash before the advance: the chunk re-walks its slice (bounded
 *   duplicate fetches) — the write-then-advance contract, never a drop.
 * - The final advance clears the cursor; the lastmod row survives it.
 * - Steady state: a second cycle over an unchanged sitemap crawls
 *   nothing; only changed and new URLs are crawled (spec: "Steady-state
 *   incremental cycle").
 * - Full-refresh source (drinkonline, no sitemap `lastmod`): every cycle
 *   re-crawls the full set (spec: "Source without lastmod").
 * - Watermark isolation at integration level: sibling jobs' rows in the
 *   shared `aggregation_watermarks` table (the time-series ISO instant,
 *   the '9194'-shaped savings cursor, another merchant's crawl row) are
 *   neither read into this job's state nor disturbed by the cycles —
 *   integration evidence for the watermark-isolation project rule.
 *
 * @module CrawlWatermarkResumeD1IntegrationTest
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LicoreaFeedAdapter } from '../../../packages/data-acquisition/src/adapters/licorea.adapter';
import { DrinkonlineFeedAdapter } from '../../../packages/data-acquisition/src/adapters/drinkonline.adapter';
import type {
  SitemapCrawlFeedAdapter,
  SitemapCrawlWiring,
} from '../../../packages/data-acquisition/src/adapters/sitemap-crawl.adapter';
import type { RawFeedRecord } from '../../../packages/data-acquisition/src/interfaces/feed-adapter.interface';
import type { PageFetcher } from '../../../packages/data-acquisition/src/crawl/crawl-walker';

import { D1CrawlWatermarkStore } from '../../../apps/api-worker/src/adapters/d1-crawl-watermark.store';

import { openMigratedD1 } from './harness';

// ---------------------------------------------------------------------------
// Fixtures — sitemap body + detail pages served by a fake fetcher
// ---------------------------------------------------------------------------

const LICOREA_SITEMAP_URL = 'https://www.licorea.com/sitemapproducts_en.xml';
const DRINKONLINE_SITEMAP_URL = 'https://www.drinkonline.eu/sitemap-products.xml';

const NON_PRODUCT_LOCS = [
  'https://www.licorea.com/31415-large_default/brugal-aniejo.jpg',
  'https://www.licorea.com/index.php?route=product/search',
];

function licoreaProductUrl(id: number): string {
  return `https://www.licorea.com/test-rum-40-07l-en-p-${id}.html`;
}

function drinkonlineProductUrl(slug: string): string {
  return `https://www.drinkonline.eu/spirits/${slug}/`;
}

function urlset(entries: readonly { loc: string; lastmod?: string | null }[]): string {
  const urls = entries
    .map(({ loc, lastmod }) =>
      `  <url><loc>${loc}</loc>${
        lastmod != null ? `<lastmod>${lastmod}</lastmod>` : ''
      }</url>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
  );
}

function productPage(name: string): string {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    offers: {
      '@type': 'Offer',
      price: '10.00',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  };
  return (
    `<!DOCTYPE html><html><head>` +
    `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` +
    `</head><body></body></html>`
  );
}

/**
 * Route-table fetcher: URL → 200 body, with every request recorded in
 * order. The recording IS the evidence for "no URL re-fetched" and "the
 * sitemap was fetched at most once per cycle".
 */
function fakeFetcher(routes: ReadonlyMap<string, string>): {
  fetcher: PageFetcher;
  fetched: string[];
} {
  const fetched: string[] = [];
  const fetcher: PageFetcher = async (url) => {
    fetched.push(url);
    const body = routes.get(url);
    if (body === undefined) {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }
    return new Response(body, { status: 200 });
  };
  return { fetcher, fetched };
}

interface Invocation {
  adapter: SitemapCrawlFeedAdapter;
  fetched: string[];
}

type D1 = ReturnType<typeof openMigratedD1>['d1'];

/** One fresh Workers-invocation stand-in: brand-new adapter AND store over the same D1. */
function invocation(
  d1: D1,
  routes: ReadonlyMap<string, string>,
  adapterClass: new (wiring: SitemapCrawlWiring) => SitemapCrawlFeedAdapter,
): Invocation {
  const store = new D1CrawlWatermarkStore(d1);
  const { fetcher, fetched } = fakeFetcher(routes);
  const adapter = new adapterClass({
    watermarkStore: store,
    cursorStore: store,
    fetcher,
    // The polite 1 s spacing is the walker's own concern (unit-pinned);
    // resume semantics never depend on wall-clock pacing.
    sleep: async () => {},
  });
  return { adapter, fetched };
}

interface CycleResult {
  discovered: Awaited<ReturnType<SitemapCrawlFeedAdapter['beginCrawlCycle']>>;
  records: RawFeedRecord[];
  errors: string[];
}

/**
 * Drive one full cycle exactly as `runCrawlFetchSteps` does — discover,
 * then chunk/advance pairs until the chunk reports done. No durable-step
 * emulation needed: resume is durable STATE under test, not step replay.
 */
async function driveCycle(
  adapter: SitemapCrawlFeedAdapter,
  feedUrl: string,
): Promise<CycleResult> {
  const discovered = await adapter.beginCrawlCycle(feedUrl);
  const records: RawFeedRecord[] = [];
  const errors: string[] = [...discovered.errors];
  if (errors.length > 0 || discovered.queueLength === 0) {
    return { discovered, records, errors };
  }
  for (let index = 1; index <= 400; index++) {
    const chunk = await adapter.crawlChunk();
    records.push(...chunk.records);
    errors.push(...chunk.errors);
    await adapter.advanceCrawl(chunk.fetched, chunk.done);
    if (chunk.done) return { discovered, records, errors };
  }
  throw new Error('test chunk cap exceeded — loop bug');
}

// ---------------------------------------------------------------------------
// Raw watermark-row inspection (through the database, not the store)
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof openMigratedD1>['db'];

function rawWatermarkRow(db: Db, jobName: string): string | null {
  const row = db
    .prepare('SELECT watermark FROM aggregation_watermarks WHERE job_name = ?')
    .get(jobName) as { watermark: string } | undefined;
  return row?.watermark ?? null;
}

function insertForeignJobRow(db: Db, jobName: string, watermark: string): void {
  db.prepare(
    `INSERT INTO aggregation_watermarks (job_name, watermark, updated_at)
     VALUES (?, ?, '2026-10-07T00:00:00.000Z')`,
  ).run(jobName, watermark);
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('crawl cycle persistence + resume on D1 (task 4.1)', () => {
  let db: Db;
  let d1: D1;
  let sitemapBody: string;
  let routes: Map<string, string>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;

    const entries = [1, 2, 3, 4, 5].map((id) => ({
      loc: licoreaProductUrl(id),
      lastmod: '2026-10-01',
    }));
    sitemapBody = urlset([...entries, ...NON_PRODUCT_LOCS.map((loc) => ({ loc }))]);
    routes = new Map<string, string>([
      [LICOREA_SITEMAP_URL, sitemapBody],
      ...[1, 2, 3, 4, 5].map((id) => [
        licoreaProductUrl(id),
        productPage(`Test Rum 40% 0,7 l #${id}`),
      ] as const),
    ]);

    // The sibling rows the isolation rule exists for: an ISO-instant
    // watermark and the '9194'-shaped numeric cursor share the table.
    insertForeignJobRow(db, 'time-series-aggregation', '2026-10-07T00:00:00.000Z');
    insertForeignJobRow(db, 'savings-snapshot-cursor', '9194');
  });

  afterEach(() => {
    db.close();
  });

  it('begin persists the lastmod map and the cursor as this job\'s rows — product URLs only', async () => {
    const { adapter, fetched } = invocation(d1, routes, LicoreaFeedAdapter);

    const discovered = await adapter.beginCrawlCycle(LICOREA_SITEMAP_URL);

    expect(discovered.errors).toEqual([]);
    expect(discovered.resumed).toBe(false);
    expect(discovered.queueLength).toBe(5);

    // The sitemap is fetched at most once per cycle — and discovery never
    // fetches detail pages.
    expect(fetched).toEqual([LICOREA_SITEMAP_URL]);

    // Cursor row: the full pending queue at offset 0, in sitemap order.
    const cursorRow = rawWatermarkRow(db, 'sitemap-crawl-cursor-licorea');
    expect(cursorRow).not.toBeNull();
    expect(JSON.parse(cursorRow!)).toEqual({
      queue: [1, 2, 3, 4, 5].map(licoreaProductUrl),
      offset: 0,
    });

    // Lastmod row: every product loc with its verbatim lastmod — and the
    // image/CMS locs never enter (filtered before the diff).
    const lastmodRow = rawWatermarkRow(db, 'sitemap-crawl-lastmod-licorea');
    expect(lastmodRow).not.toBeNull();
    const decoded = JSON.parse(lastmodRow!) as Record<string, string | null>;
    expect(Object.keys(decoded).sort()).toEqual(
      [1, 2, 3, 4, 5].map((id) => licoreaProductUrl(id)).sort(),
    );
    expect([...new Set(Object.values(decoded))]).toEqual(['2026-10-01']);

    // Job-scoped reads: the merchant's own row is what loads back, and the
    // sibling jobs' rows (different semantics entirely) are neither leaked
    // into this read nor disturbed by the writes.
    const store = new D1CrawlWatermarkStore(d1);
    expect(await store.load('licorea')).toEqual(
      new Map([1, 2, 3, 4, 5].map((id) => [licoreaProductUrl(id), '2026-10-01'] as const)),
    );
    expect(await store.loadCursor('licorea')).toEqual({
      queue: [1, 2, 3, 4, 5].map(licoreaProductUrl),
      offset: 0,
    });
    expect(rawWatermarkRow(db, 'time-series-aggregation')).toBe(
      '2026-10-07T00:00:00.000Z',
    );
    expect(rawWatermarkRow(db, 'savings-snapshot-cursor')).toBe('9194');
  });

  it('a crashed invocation (chunk walked, advance lost) resumes from the cursor without re-discovery', async () => {
    const first = invocation(d1, routes, LicoreaFeedAdapter);
    await first.adapter.beginCrawlCycle(LICOREA_SITEMAP_URL);
    const chunk = await first.adapter.crawlChunk();
    expect(chunk.records).toHaveLength(5);
    expect(chunk.done).toBe(true);
    // The crash: the advance never runs. The records were reported but the
    // cursor still sits at offset 0.

    // Fresh invocation (new adapter AND new store — same durable D1):
    // the in-flight cursor IS the cycle. No sitemap fetch, no re-diff.
    const second = invocation(d1, routes, LicoreaFeedAdapter);
    const resumed = await second.adapter.beginCrawlCycle(LICOREA_SITEMAP_URL);
    expect(resumed.resumed).toBe(true);
    expect(resumed.queueLength).toBe(5);
    expect(resumed.errors).toEqual([]);
    expect(second.fetched).toEqual([]); // not even the sitemap

    // The slice re-walks (bounded duplicate fetches, idempotent upserts
    // downstream) — records are re-fetched, never silently dropped.
    const rechunk = await second.adapter.crawlChunk();
    expect(rechunk.records).toHaveLength(5);
    expect(rechunk.done).toBe(true);
    expect(second.fetched).toEqual([1, 2, 3, 4, 5].map(licoreaProductUrl));

    // The final advance ends the cycle: cursor gone, lastmod row kept.
    await second.adapter.advanceCrawl(rechunk.fetched, rechunk.done);
    expect(rawWatermarkRow(db, 'sitemap-crawl-cursor-licorea')).toBeNull();
    expect(rawWatermarkRow(db, 'sitemap-crawl-lastmod-licorea')).not.toBeNull();

    // The whole crash-and-resume never touched the sibling rows.
    expect(rawWatermarkRow(db, 'time-series-aggregation')).toBe(
      '2026-10-07T00:00:00.000Z',
    );
    expect(rawWatermarkRow(db, 'savings-snapshot-cursor')).toBe('9194');
  });

  it('the advance persists the offset; the next invocation never re-fetches the advanced prefix', async () => {
    // 305 URLs force two chunks (D5: ≤ 300 fetches per chunk) so the
    // mid-cycle advance is real, not the final one.
    const entries = Array.from({ length: 305 }, (_, i) => ({
      loc: licoreaProductUrl(i + 1),
      lastmod: '2026-10-01',
    }));
    const bigSitemap = urlset(entries);
    const bigRoutes = new Map<string, string>([
      [LICOREA_SITEMAP_URL, bigSitemap],
      ...entries.map(({ loc }) => [loc, productPage('Test Rum 40% 0,7 l')] as const),
    ]);

    const first = invocation(d1, bigRoutes, LicoreaFeedAdapter);
    await first.adapter.beginCrawlCycle(LICOREA_SITEMAP_URL);
    const chunk1 = await first.adapter.crawlChunk();
    expect(chunk1.fetched).toBe(300);
    expect(chunk1.done).toBe(false);
    await first.adapter.advanceCrawl(chunk1.fetched, chunk1.done);

    // The offset is durable: a fresh invocation reads offset 300 and the
    // queue's 5-URL remainder.
    const second = invocation(d1, bigRoutes, LicoreaFeedAdapter);
    const resumed = await second.adapter.beginCrawlCycle(LICOREA_SITEMAP_URL);
    expect(resumed.resumed).toBe(true);
    expect(resumed.queueLength).toBe(5);

    const chunk2 = await second.adapter.crawlChunk();
    expect(chunk2.records).toHaveLength(5);
    expect(chunk2.done).toBe(true);
    // Not one of the 300 advanced URLs was re-fetched: the resumed
    // invocation fetched only the remainder, sitemap included.
    const advancedPrefix = new Set(entries.slice(0, 300).map((e) => e.loc));
    expect(second.fetched).toHaveLength(5); // pages only — the sitemap was NOT re-fetched
    expect(second.fetched.filter((url) => advancedPrefix.has(url))).toEqual([]);

    await second.adapter.advanceCrawl(chunk2.fetched, chunk2.done);
    expect(rawWatermarkRow(db, 'sitemap-crawl-cursor-licorea')).toBeNull();

    // Across both invocations: one sitemap fetch, 305 page fetches, no
    // URL twice — the sitemap-at-most-once and bounded-queue contracts.
    const allFetched = [...first.fetched, ...second.fetched];
    expect(allFetched.filter((url) => url === LICOREA_SITEMAP_URL)).toHaveLength(1);
    expect(new Set(allFetched).size).toBe(allFetched.length);
    expect(allFetched).toHaveLength(306);
  });

  it('steady state: unchanged lastmods crawl nothing; only changed and new URLs crawl', async () => {
    // Cycle 1 — first crawl is a full refresh, completed cleanly.
    const cycle1 = invocation(d1, routes, LicoreaFeedAdapter);
    const first = await driveCycle(cycle1.adapter, LICOREA_SITEMAP_URL);
    expect(first.discovered.queueLength).toBe(5);
    expect(first.records).toHaveLength(5);
    expect(cycle1.fetched).toHaveLength(6); // sitemap + 5 pages

    const watermarkAfterCycle1 = rawWatermarkRow(db, 'sitemap-crawl-lastmod-licorea');

    // Cycle 2 — identical sitemap: discovery crawls nothing, the cursor
    // never exists, and the watermark is rewritten (same content).
    const cycle2 = invocation(d1, routes, LicoreaFeedAdapter);
    const second = await driveCycle(cycle2.adapter, LICOREA_SITEMAP_URL);
    expect(second.discovered.queueLength).toBe(0);
    expect(second.discovered.resumed).toBe(false);
    expect(second.discovered.errors).toEqual([]);
    expect(second.records).toEqual([]);
    expect(cycle2.fetched).toEqual([LICOREA_SITEMAP_URL]);
    expect(rawWatermarkRow(db, 'sitemap-crawl-cursor-licorea')).toBeNull();
    expect(rawWatermarkRow(db, 'sitemap-crawl-lastmod-licorea')).toBe(
      watermarkAfterCycle1,
    );

    // Cycle 3 — one lastmod changed, one URL added: exactly those crawl.
    const changedSitemap = urlset([
      { loc: licoreaProductUrl(1), lastmod: '2026-10-01' },
      { loc: licoreaProductUrl(2), lastmod: '2026-10-06' },
      { loc: licoreaProductUrl(3), lastmod: '2026-10-01' },
      { loc: licoreaProductUrl(4), lastmod: '2026-10-01' },
      { loc: licoreaProductUrl(5), lastmod: '2026-10-01' },
      { loc: licoreaProductUrl(6), lastmod: '2026-10-06' },
    ]);
    const cycle3Routes = new Map(routes);
    cycle3Routes.set(LICOREA_SITEMAP_URL, changedSitemap);
    cycle3Routes.set(licoreaProductUrl(6), productPage('Test Rum 40% 0,7 l #6'));
    const cycle3 = invocation(d1, cycle3Routes, LicoreaFeedAdapter);
    const third = await driveCycle(cycle3.adapter, LICOREA_SITEMAP_URL);
    expect(third.discovered.queueLength).toBe(2);
    const crawled = cycle3.fetched.filter((url) => url !== LICOREA_SITEMAP_URL);
    expect(crawled.sort()).toEqual(
      [licoreaProductUrl(2), licoreaProductUrl(6)].sort(),
    );
    expect(third.records).toHaveLength(2);

    // The cycle ends cleanly and the watermark carries the new state.
    expect(rawWatermarkRow(db, 'sitemap-crawl-cursor-licorea')).toBeNull();
    const finalWatermark = JSON.parse(
      rawWatermarkRow(db, 'sitemap-crawl-lastmod-licorea')!,
    ) as Record<string, string>;
    expect(finalWatermark[licoreaProductUrl(2)]).toBe('2026-10-06');
    expect(finalWatermark[licoreaProductUrl(6)]).toBe('2026-10-06');
    expect(Object.keys(finalWatermark)).toHaveLength(6);
  });

  it('another merchant\'s crawl rows are never seen nor disturbed by this merchant\'s cycle', async () => {
    const other = new D1CrawlWatermarkStore(d1);
    await other.save('viinikauppa', new Map([['https://www.viinikauppa.com/catalog/whisky', '2026-09-01']]));

    const { adapter } = invocation(d1, routes, LicoreaFeedAdapter);
    await driveCycle(adapter, LICOREA_SITEMAP_URL);

    const viinikauppaRow = rawWatermarkRow(db, 'sitemap-crawl-lastmod-viinikauppa');
    expect(JSON.parse(viinikauppaRow!)).toEqual({
      'https://www.viinikauppa.com/catalog/whisky': '2026-09-01',
    });
    // A licorea read returns licorea's own row — never the sibling's.
    expect((await other.load('licorea'))!.size).toBe(5);
    expect(await other.loadCursor('viinikauppa')).toBeNull();
  });
});

describe('full-refresh source (drinkonline, no sitemap lastmod) on D1 (task 4.1)', () => {
  let db: Db;
  let d1: D1;
  let routes: Map<string, string>;

  beforeEach(() => {
    const opened = openMigratedD1();
    db = opened.db;
    d1 = opened.d1;

    const locs = ['highland-single-malt', 'gin-dry-original'].map(drinkonlineProductUrl);
    routes = new Map<string, string>([
      [DRINKONLINE_SITEMAP_URL, urlset(locs.map((loc) => ({ loc })))],
      ...locs.map((loc) => [loc, productPage('Test Rum 40% 0,5 l')] as const),
    ]);
  });

  afterEach(() => {
    db.close();
  });

  it('every cycle re-crawls the full set, chunked and resumably', async () => {
    const cycle1 = invocation(d1, routes, DrinkonlineFeedAdapter);
    const first = await driveCycle(cycle1.adapter, DRINKONLINE_SITEMAP_URL);
    expect(first.discovered.queueLength).toBe(2);
    expect(first.records).toHaveLength(2);

    // Unchanged sitemap, yet a full set again — no lastmod, no increment.
    const cycle2 = invocation(d1, routes, DrinkonlineFeedAdapter);
    const second = await driveCycle(cycle2.adapter, DRINKONLINE_SITEMAP_URL);
    expect(second.discovered.queueLength).toBe(2);
    expect(second.discovered.resumed).toBe(false);
    expect(second.records).toHaveLength(2);
    expect(
      cycle2.fetched.filter((url) => url !== DRINKONLINE_SITEMAP_URL).sort(),
    ).toEqual(
      ['highland-single-malt', 'gin-dry-original']
        .map(drinkonlineProductUrl)
        .sort(),
    );

    // Both cycles ended with the cursor cleared; only drinkonline rows exist.
    expect(rawWatermarkRow(db, 'sitemap-crawl-cursor-drinkonline')).toBeNull();
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM aggregation_watermarks
            WHERE job_name LIKE 'sitemap-crawl-%'`,
        )
        .get() as { n: number },
    ).toEqual({ n: 1 });
  });
});

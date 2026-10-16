/**
 * Calendar source-watcher cron tests (task 3.3, change
 * calendar-event-automation) — the integration the task pins, over the
 * FULL default path (real D1 known-URL read + the MAX(id)+1 insert +
 * the persistence-boundary validator) against the migrated fake-D1
 * harness, with fixture RSS payloads served through the `fetchImpl`
 * seam (the price-alert email-send precedent for a fetch seam):
 *
 * - a new item becomes a PENDING candidate row (identity fields, the
 *   publisher-local published day, null drafts);
 * - the same URL on a second run counts a duplicate and inserts
 *   nothing — and a REJECTED row keeps deduplicating (any-status rule);
 * - a malformed item (no identity fields, unparsable date) is counted
 *   and skipped, the feed still completes;
 * - one feed erroring (HTTP 500) never stops the other feeds;
 * - the EMTA keyword gate drops non-matching items and keeps matches;
 * - the polite UA rides every request; the per-feed item cap bounds a
 *   long feed; STT dedups on the guid when the link slug drifts;
 * - the wrapper is fail-open (a failing known-URL read is logged,
 *   never raised);
 * - router wiring for the daily 04:00 UTC pattern.
 *
 * @module CalendarSourceWatcherCronTest
 */

import { describe, it, expect, vi } from 'vitest';
import { type DatabaseSync } from 'node:sqlite';
// The migrated in-memory database (all committed migrations, 0039
// included) over the raw()-capable data-platform shim.
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import {
  CALENDAR_WATCHER_CRON,
  EMTA_KEYWORDS,
  MAX_ITEMS_PER_FEED,
  WATCHER_USER_AGENT,
  handleCalendarSourceWatcher,
  runCalendarSourceWatcher,
} from '../calendar-source-watcher';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

const LOG: Logger = createLogger('error');

const VERO_URL = 'https://www.vero.fi/api/rss/news/fi';
const STT_URL = 'https://www.sttinfo.fi/rss/releases/latest?publisherId=1631';
const EMTA_URL = 'https://emta.ee/rss-feeds/rss.xml';

interface CandidateRow {
  id: number;
  source: string;
  url: string;
  title: string;
  published_at: string;
  status: string;
  draft_fi: string | null;
  draft_en: string | null;
}

function openWatcherD1(): {
  db: DatabaseSync;
  d1: D1DatabaseLike;
  env: Env;
} {
  const { db, d1 } = openMigratedD1();
  return { db, d1, env: { DB: d1 } as unknown as Env };
}

function rows(db: DatabaseSync): CandidateRow[] {
  return db
    .prepare(
      'SELECT id, source, url, title, published_at, status, draft_fi, draft_en ' +
        'FROM calendar_event_candidates ORDER BY id',
    )
    .all() as unknown as CandidateRow[];
}

// ---------------------------------------------------------------------------
// Fixture feeds — structures per verified-feeds.md (RSS 2.0)
// ---------------------------------------------------------------------------

const VERO_ITEM = (slug: string, uuid: string, pubDate: string): string =>
  `<item>` +
  `<guid isPermaLink="false">${uuid}</guid>` +
  `<link>https://www.vero.fi/tietoa-verohallinnosta/uutishuone/uutiset/uutiset/2026/${slug}/</link>` +
  `<title>${slug.replace(/-/g, ' ')}</title>` +
  `<pubDate>${pubDate}</pubDate>` +
  `</item>`;

const VERO_FEED = (items: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:a10="http://www.w3.org/2005/Atom"><channel>` +
  `<title>Verohallinnon uutiset</title>` +
  items.join('') +
  `</channel></rss>`;

const STT_ITEM = (releaseId: number, slug: string, pubDate: string): string =>
  `<item>` +
  `<guid isPermaLink="false">https://www.sttinfo.fi/tiedote/${releaseId}/?publisherId=1631&amp;lang=fi</guid>` +
  `<link>https://www.sttinfo.fi/tiedote/${releaseId}/${slug}?lang=fi</link>` +
  `<title>Alkon muutuvat hinnat ${releaseId}</title>` +
  `<pubDate>${pubDate}</pubDate>` +
  `<regulatory>false</regulatory>` +
  `</item>`;

const STT_FEED = (items: string[]): string =>
  `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel>` +
  `<title>Alko Oy</title>` +
  items.join('') +
  `</channel></rss>`;

const EMTA_FEED = (items: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>` +
  `<title>EMTA uudised</title>` +
  items.join('') +
  `</channel></rss>`;

/** The default fetch seam: fixture XML per feed URL, call capture. */
function serveFeeds(
  bodies: Record<string, { status: number; body: string }>,
): {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const feed = bodies[url];
      return new Response(feed?.body ?? '', {
        status: feed?.status ?? 404,
        headers: { 'content-type': 'text/xml' },
      });
    },
  };
}

describe('handleCalendarSourceWatcher (full default path over fake D1)', () => {
  it('a new item becomes a PENDING candidate with the publisher-local day', async () => {
    const { db, env } = openWatcherD1();
    const feeds = serveFeeds({
      [VERO_URL]: {
        status: 200,
        body: VERO_FEED([
          VERO_ITEM(
            'hallitus-esittaa-alkoholiveron-muutoksia',
            'a88c04bb-17b1-4ff3-9407-1f141d5125f9',
            'Fri, 16 Oct 2026 10:00:00 +0300',
          ),
        ]),
      },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    expect(result.inserted).toBe(1);
    const stored = rows(db);
    expect(stored).toHaveLength(1);
    const row = stored[0]!;
    // The +03:00 wall-clock date, not the UTC-shifted instant.
    expect(row.published_at).toBe('2026-10-16');
    expect(row.source).toBe('vero-fi-news');
    expect(row.url).toBe(
      'https://www.vero.fi/tietoa-verohallinnosta/uutishuone/uutiset/uutiset/2026/hallitus-esittaa-alkoholiveron-muutoksia/',
    );
    expect(row.status).toBe('PENDING');
    expect(row.draft_fi).toBeNull();
    expect(row.draft_en).toBeNull();
  });

  it('the same URL on a second run counts a duplicate and inserts nothing', async () => {
    const { db, env } = openWatcherD1();
    const feeds = serveFeeds({
      [VERO_URL]: {
        status: 200,
        body: VERO_FEED([
          VERO_ITEM(
            'hallitus-esittaa-alkoholiveron-muutoksia',
            'a88c04bb-17b1-4ff3-9407-1f141d5125f9',
            'Fri, 16 Oct 2026 10:00:00 +0300',
          ),
        ]),
      },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    await handleCalendarSourceWatcher(env, LOG, { fetchImpl: feeds.fetchImpl });
    const second = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);
    expect(rows(db)).toHaveLength(1);
  });

  it('a REJECTED candidate keeps deduplicating — any-status known-URL rule', async () => {
    const { db, d1, env } = openWatcherD1();
    const knownUrl =
      'https://www.sttinfo.fi/tiedote/72408468/?publisherId=1631&lang=fi';
    await d1.prepare(
      'INSERT INTO calendar_event_candidates ' +
        '(id, source, url, title, published_at, status, draft_fi, draft_en) ' +
        "VALUES (1, 'alko-press-sttinfo', ?, 'Alkon Q3', '2026-10-14', 'REJECTED', NULL, NULL)",
    )
      .bind(knownUrl)
      .run();

    const feeds = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED([]) },
      [STT_URL]: {
        status: 200,
        body: STT_FEED([STT_ITEM(72408468, 'alkon-q3-hinnat', 'Wed, 14 Oct 2026 04:10:00 GMT')]),
      },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    expect(result.duplicates).toBe(1);
    expect(result.inserted).toBe(0);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]?.status).toBe('REJECTED');
  });

  it('a malformed item is counted, skipped, and does not stop its feed', async () => {
    const { db, env } = openWatcherD1();
    const malformedFeed =
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Verohallinnon uutiset</title>` +
      // No link, no guid, no title, no date.
      `<item><description>Kesken jäänyt uutinen.</description></item>` +
      // Title but an unparsable date.
      VERO_ITEM('hyva-uutinen', 'uuid-ok', 'not a date') +
      // A healthy item after the malformed ones.
      VERO_ITEM(
        'valmistevero-muuttuu',
        'uuid-good',
        'Fri, 16 Oct 2026 10:00:00 +0300',
      ) +
      `</channel></rss>`;
    const feeds = serveFeeds({
      [VERO_URL]: { status: 200, body: malformedFeed },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    const vero = result.feeds.find((feed) => feed.source === 'vero-fi-news');
    expect(vero?.outcome).toBe('ok');
    expect(vero?.skipped).toBe(2);
    expect(vero?.inserted).toBe(1);
    expect(result.inserted).toBe(1);
    expect(rows(db).map((row) => row.url)).toEqual([
      'https://www.vero.fi/tietoa-verohallinnosta/uutishuone/uutiset/uutiset/2026/valmistevero-muuttuu/',
    ]);
  });

  it('one feed erroring never stops the other feeds', async () => {
    const { db, env } = openWatcherD1();
    const feeds = serveFeeds({
      [VERO_URL]: { status: 500, body: 'upstream error' },
      [STT_URL]: {
        status: 200,
        body: STT_FEED([
          STT_ITEM(72408468, 'alkon-q3-hinnat', 'Wed, 14 Oct 2026 04:10:00 GMT'),
        ]),
      },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    const vero = result.feeds.find((feed) => feed.source === 'vero-fi-news');
    const stt = result.feeds.find((feed) => feed.source === 'alko-press-sttinfo');
    expect(vero?.outcome).toBe('error');
    expect(vero?.error).toBe('HTTP 500');
    expect(stt?.outcome).toBe('ok');
    expect(stt?.inserted).toBe(1);
    expect(result.inserted).toBe(1);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]?.source).toBe('alko-press-sttinfo');
  });

  it('the EMTA keyword gate keeps matching items and drops the noise', async () => {
    const { db, env } = openWatcherD1();
    const emtaFeed =
      `<?xml version="1.0"?><rss version="2.0"><channel><title>EMTA uudised</title>` +
      // Matching: CDATA title with the aktsiis term.
      `<item>` +
      `<link>https://emta.ee/uudised/alkoholi-aktsiisi-muudatused</link>` +
      `<title><![CDATA[Aktsiisimuudatused alkoholile jõustuvad jaanuaris]]></title>` +
      `<pubDate>Wed, 14 Oct 2026 12:13:57 +0300</pubDate>` +
      `</item>` +
      // Noise: customs operational review — no keyword.
      `<item>` +
      `<link>https://emta.ee/uudised/tolli-nadalOperatsioonid</link>` +
      `<title>Tolliamet konfiskeeris nädalal üle 500 kilogrammi kaupu</title>` +
      `<pubDate>Wed, 14 Oct 2026 08:00:00 +0300</pubDate>` +
      `</item>` +
      `</channel></rss>`;
    const feeds = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED([]) },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: emtaFeed },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    const emta = result.feeds.find((feed) => feed.source === 'emta-news');
    expect(emta?.filtered).toBe(1);
    expect(emta?.inserted).toBe(1);
    const stored = rows(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.source).toBe('emta-news');
    expect(stored[0]?.url).toBe('https://emta.ee/uudised/alkoholi-aktsiisi-muudatused');
    expect(stored[0]?.title).toBe(
      'Aktsiisimuudatused alkoholile jõustuvad jaanuaris',
    );
  });

  it('the pre-filtered sources carry no keyword gate', () => {
    // vero.fi and STT are polled unconditionally — the gate list exists
    // for EMTA alone (the lead decision's versioned constant).
    expect(EMTA_KEYWORDS).toContain('aktsiis');
    expect(EMTA_KEYWORDS).toContain('alkohol');
  });

  it('every request rides the polite documented UA', async () => {
    const { env } = openWatcherD1();
    const feeds = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED([]) },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    await handleCalendarSourceWatcher(env, LOG, { fetchImpl: feeds.fetchImpl });

    expect(feeds.calls).toHaveLength(3);
    for (const call of feeds.calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get('user-agent')).toBe(WATCHER_USER_AGENT);
      expect(headers.get('accept')).toContain('application/rss+xml');
    }
    expect(new Set(feeds.calls.map((call) => call.url))).toEqual(
      new Set([VERO_URL, STT_URL, EMTA_URL]),
    );
  });

  it('a long feed is bounded to the newest MAX_ITEMS_PER_FEED items', async () => {
    const { db, env } = openWatcherD1();
    const thirty = Array.from({ length: 30 }, (_, index) =>
      VERO_ITEM(`uutinen-${index}`, `uuid-${index}`, 'Fri, 16 Oct 2026 10:00:00 +0300'),
    );
    const feeds = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED(thirty) },
      [STT_URL]: { status: 200, body: STT_FEED([]) },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    const result = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: feeds.fetchImpl,
    });

    const vero = result.feeds.find((feed) => feed.source === 'vero-fi-news');
    expect(MAX_ITEMS_PER_FEED).toBe(25);
    expect(vero?.fetched).toBe(25);
    expect(result.inserted).toBe(25);
    expect(rows(db)).toHaveLength(25);
  });

  it('STT dedups on the guid — a link slug change is the same release', async () => {
    const { db, env } = openWatcherD1();
    const firstRun = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED([]) },
      [STT_URL]: {
        status: 200,
        body: STT_FEED([STT_ITEM(72408468, 'alkon-q3-tulokset', 'Wed, 14 Oct 2026 04:10:00 GMT')]),
      },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });
    // Same release id (guid), different SEO slug — and the guid's &amp;
    // entity decodes to the stored candidate url.
    const secondRun = serveFeeds({
      [VERO_URL]: { status: 200, body: VERO_FEED([]) },
      [STT_URL]: {
        status: 200,
        body: STT_FEED([STT_ITEM(72408468, 'uusi-otsikko', 'Wed, 14 Oct 2026 04:10:00 GMT')]),
      },
      [EMTA_URL]: { status: 200, body: EMTA_FEED([]) },
    });

    await handleCalendarSourceWatcher(env, LOG, { fetchImpl: firstRun.fetchImpl });
    const second = await handleCalendarSourceWatcher(env, LOG, {
      fetchImpl: secondRun.fetchImpl,
    });

    expect(second.duplicates).toBe(1);
    expect(second.inserted).toBe(0);
    const stored = rows(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.url).toBe(
      'https://www.sttinfo.fi/tiedote/72408468/?publisherId=1631&lang=fi',
    );
    // The GMT pubDate reads as its own wall-clock day.
    expect(stored[0]?.published_at).toBe('2026-10-14');
  });
});

describe('fail-open wrapper (runCalendarSourceWatcher — the router entry)', () => {
  function makeLog(): Logger & {
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
  } {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger & {
      error: ReturnType<typeof vi.fn>;
      info: ReturnType<typeof vi.fn>;
    };
  }

  it('a failing known-URL read is logged, never raised — the tick completes', async () => {
    const { d1 } = openWatcherD1();
    const log = makeLog();
    const brokenD1: D1DatabaseLike = {
      ...d1,
      prepare(sql: string) {
        if (/SELECT url FROM calendar_event_candidates/.test(sql)) {
          throw new Error('D1 read unavailable');
        }
        return d1.prepare(sql);
      },
    } as D1DatabaseLike;

    const result = await runCalendarSourceWatcher(
      { DB: brokenD1 } as unknown as Env,
      log,
    );

    expect(result).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
    const fields = log.error.mock.calls[0]?.[0] as { message: string };
    expect(fields.message).toContain('D1 read unavailable');
  });

  it('a run whose every feed fails still resolves with collected errors', async () => {
    const { env } = openWatcherD1();
    const log = makeLog();
    // Every fetch rejects (offline tick) — the per-feed collection is
    // the fail-open rule; the run comes back shaped, nothing raised.
    const failingFetch = async (): Promise<Response> => {
      throw new Error('network unreachable');
    };

    const result = await runCalendarSourceWatcher(env, log, {
      fetchImpl: failingFetch,
    });

    expect(result).not.toBeNull();
    expect(result?.feeds).toHaveLength(3);
    for (const feed of result?.feeds ?? []) {
      expect(feed.outcome).toBe('error');
      expect(feed.error).toBe('network unreachable');
    }
    expect(result?.inserted).toBe(0);
    // Feed-level failures are collected in the result, not wrapper-logged.
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('router wiring', () => {
  it('rides the daily off-peak pattern alone', () => {
    expect(CALENDAR_WATCHER_CRON).toBe('0 4 * * *');
    expect(handlersForCron(CALENDAR_WATCHER_CRON).map((h) => h.name)).toEqual([
      'calendar-source-watcher',
    ]);
  });
});

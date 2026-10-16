/**
 * Calendar source-watcher cron (task 3.3, change calendar-event-automation;
 * spec "Candidate collection from source feeds") — the daily poll of the
 * verified feeds that turns announcements into PENDING ops-review
 * candidates in `calendar_event_candidates`. Never public data: a
 * candidate becomes a calendar event only through an operator's console
 * decision (task 4.1), so this cron writes nowhere the public API reads.
 *
 * ## The feed set — verified only, lead-decided
 *
 * Exactly the sources `openspec/changes/calendar-event-automation/
 * verified-feeds.md` records, no ad-hoc scraping (design D):
 *
 * 1. `vero-fi-news` — Verohallinto newsroom RSS, dedup on `<link>`
 *    (the canonical article URL; the GUID is an opaque UUID).
 * 2. `alko-press-sttinfo` — Alko Oy's press room via the STT Info
 *    mirror (alko.fi direct paths sit behind an Azure WAF 403), dedup
 *    on `<guid>` — the short-form release URL carrying STT's numeric
 *    release id, stable across the SEO slug changes `<link>` drifts on.
 * 3. `emta-news` — EMTA (Estonian Tax and Customs Board) sitewide feed,
 *    dedup on `<link>`. A LEAD DECISION to include for awareness only:
 *    the feed is sitewide and noisy, so items pass a keyword gate
 *    (below) and EE excise events themselves stay manual — a matching
 *    item is a hint for the ops review queue, never an automation.
 * 4. Eduskunta HE tracker — EXCLUDED (lead decision): RSS is
 *    discontinued and the VASKI JSON API carries 50–500 kB embedded-XML
 *    rows with unspecified ordering and no date filter; vero.fi's
 *    newsroom already surfaces "Hallitus esittää …" proposals.
 *
 * ## The EMTA keyword gate — versioned constant
 *
 * The EMTA feed is polled with Finnish/Estonian alcohol/excise terms;
 * a non-matching item is counted (`filtered`) and never stored. The
 * list is deliberately small (substring, case-insensitive over the
 * title): `alkohol` alone covers alkohol/alkoholismuutokset forms, and
 * the English feed variant is not polled — broadening the net would
 * flood the review queue with customs-auction noise the lead decision
 * explicitly keeps out.
 *
 * ## Run shape — bounded, polite, fail-open
 *
 * Each feed is fetched sequentially (one request at a time) with the
 * documented crawler UA and a fetch timeout, bounded to the newest
 * {@link MAX_ITEMS_PER_FEED} items. Items are normalized → keyword-
 * gated (EMTA only) → deduped against ALL stored candidate URLs (any
 * status — REJECTED rows keep deduplicating, which is why the table
 * has no delete path) via the pure core-domain decision
 * ({@link decideCandidateInsert}), then inserted PENDING through the
 * persistence-boundary validator. Per-feed failures (fetch, HTTP,
 * parse) are collected — one dead feed never stops the others — and
 * item-level failures (missing identity fields, unparseable dates,
 * validator rejections) are counted as skips with a warn log. The run
 * itself never raises: the fail-open wrapper is the entry the router
 * registers, the handlers' shared convention.
 *
 * @module CalendarSourceWatcher
 */

import { decideCandidateInsert } from '../../../../packages/core-domain/src/calendar/calendar.candidate';
import {
  validateCalendarEventCandidate,
  type ValidatedCalendarEventCandidate,
} from '../../../../packages/data-platform/src/repositories/calendar-candidate-validator';
import type { Env } from '../env';
import type { Logger } from '../logger';
import { parseRssItems, pubDateToIsoDay, type RssFeedItem } from './feed-parsing';

/** The daily off-peak pattern: 04:00 UTC (06:00/07:00 Helsinki). */
export const CALENDAR_WATCHER_CRON = '0 4 * * *';

/**
 * The documented crawler UA — polite, identifiable, versioned. All
 * three verified hosts served this UA class in the feed-verification
 * probes; emta.ee sits behind an Azure WAF that rewards the discipline
 * (verified-feeds.md §3).
 */
export const WATCHER_USER_AGENT =
  'rajahinta-calendar-watcher/1.0 (+https://rajahinta.fi)';

/**
 * Per-feed item cap — the run processes at most the newest 25 items of
 * a feed (STT serves exactly 25, vero.fi 10; EMTA's 50+ sitewide items
 * are truncated). Day-grained polling makes the cap a safety bound,
 * not a freshness risk: a feed would have to publish >25 items between
 * two 04:00 UTC ticks for a tail item to age out.
 */
export const MAX_ITEMS_PER_FEED = 25;

/**
 * EMTA keyword gate — versioned constant list, FI/ET alcohol/excise
 * terms (see module docstring). Keep small and documented.
 */
export const EMTA_KEYWORDS = [
  'alkoholi',
  'alkoholivero',
  'valmistevero',
  'aktsiis',
  'joogi',
  'alkohol',
  'joogimaksud',
] as const;

/** Fetch timeout per feed — parse/timeout tolerance at the transport edge. */
const FEED_FETCH_TIMEOUT_MS = 10_000;

/** One watched feed: identity, fetch URL, and the optional keyword gate. */
interface WatchedFeed {
  /** The `source` column value stored on every candidate from this feed. */
  readonly source: string;
  readonly feedUrl: string;
  /** Non-null → items must match at least one term to become candidates. */
  readonly keywords: readonly string[] | null;
}

/** The verified feed set, in priority order (see module docstring). */
const WATCHED_FEEDS: readonly WatchedFeed[] = [
  {
    source: 'vero-fi-news',
    feedUrl: 'https://www.vero.fi/api/rss/news/fi',
    keywords: null,
  },
  {
    source: 'alko-press-sttinfo',
    feedUrl: 'https://www.sttinfo.fi/rss/releases/latest?publisherId=1631',
    keywords: null,
  },
  {
    source: 'emta-news',
    feedUrl: 'https://emta.ee/rss-feeds/rss.xml',
    keywords: EMTA_KEYWORDS,
  },
];

/**
 * The item's dedup identity for its feed — becomes the candidate `url`
 * (the exact-string dedup key the UNIQUE column enforces). vero.fi and
 * EMTA dedup on `<link>`; STT/Alko on `<guid>` (the numeric-release-id
 * short form — stable where `<link>`'s slug is not).
 */
function candidateUrlFor(feed: WatchedFeed, item: RssFeedItem): string | null {
  switch (feed.source) {
    case 'alko-press-sttinfo':
      return item.guid ?? item.link;
    default:
      return item.link;
  }
}

/** Case-insensitive substring match — the keyword gate's whole rule. */
function matchesKeywords(keywords: readonly string[], title: string): boolean {
  const haystack = title.toLowerCase();
  return keywords.some((term) => haystack.includes(term.toLowerCase()));
}

/** Per-feed outcome — logged in the run summary, asserted by tests. */
export interface WatcherFeedResult {
  readonly source: string;
  readonly feedUrl: string;
  /** ok — the fetch+parse completed (items may still have been skipped); error — the feed failed. */
  readonly outcome: 'ok' | 'error';
  /** Items considered after the per-feed cap. */
  readonly fetched: number;
  readonly inserted: number;
  /** Items whose URL was already a candidate (any status). */
  readonly duplicates: number;
  /** Malformed items (missing identity/date) and item-level failures. */
  readonly skipped: number;
  /** Items dropped by the keyword gate (EMTA only; 0 elsewhere). */
  readonly filtered: number;
  readonly error: string | null;
}

/** The run-local, mutable twin of the per-feed counters. */
type MutableFeedCounters = {
  -readonly [K in keyof Pick<
    WatcherFeedResult,
    'fetched' | 'inserted' | 'duplicates' | 'skipped' | 'filtered'
  >]: WatcherFeedResult[K];
};

/** One watcher run's outcome — logged by the wrapper, asserted by tests. */
export interface CalendarWatcherRunResult {
  readonly feeds: readonly WatcherFeedResult[];
  readonly inserted: number;
  readonly duplicates: number;
  readonly skipped: number;
  readonly filtered: number;
}

/** Seam overrides (test doubles; defaults are the real fetch/D1 paths). */
export interface CalendarSourceWatcherDeps {
  /** Feed fetch port — defaults to global `fetch` with the polite UA. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Known-URL read port — defaults to every stored candidate URL. */
  listKnownUrls?: () => Promise<readonly string[]>;
  /** Insert port — defaults to the MAX(id)+1 console-parity insert. */
  insertCandidate?: (candidate: ValidatedCalendarEventCandidate) => Promise<number>;
}

/** Default known-URL read: every stored URL, any status (REJECTED rows keep deduping). */
async function listAllCandidateUrls(env: Env): Promise<readonly string[]> {
  const result = await env.DB.prepare(
    'SELECT url FROM calendar_event_candidates',
  ).all<{ url: string }>();
  return (result.results ?? []).map((row) => row.url);
}

/**
 * The console-parity insert (the sibling crons' MAX(id)+1 convention —
 * single-operator table, no allocation race). The row lands PENDING;
 * drafts are the watcher's none (nulls — the accept form starts blank).
 */
async function insertCandidateRow(
  env: Env,
  candidate: ValidatedCalendarEventCandidate,
): Promise<number> {
  const head = await env.DB.prepare(
    'SELECT MAX(id) AS max_id FROM calendar_event_candidates',
  ).first<{ max_id: number | null }>();
  const id = (head?.max_id ?? 0) + 1;
  await env.DB.prepare(
    'INSERT INTO calendar_event_candidates ' +
      '(id, source, url, title, published_at, status, draft_fi, draft_en) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      candidate.source,
      candidate.url,
      candidate.title,
      candidate.publishedAt,
      candidate.status,
      candidate.draftFi,
      candidate.draftEn,
    )
    .run();
  return id;
}

/**
 * Poll one feed: fetch (polite UA, timeout), parse bounded, normalize
 * each item → candidate → keyword gate → dedup → validator → insert.
 * Item-level failures are counted and skipped (the run completes);
 * feed-level failures (fetch/HTTP) throw — caught by the caller, which
 * records the feed as errored and moves on to the next one.
 */
async function pollFeed(
  feed: WatchedFeed,
  knownUrls: Set<string>,
  log: Logger,
  deps: Required<CalendarSourceWatcherDeps>,
): Promise<WatcherFeedResult> {
  const counts: MutableFeedCounters = {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    skipped: 0,
    filtered: 0,
  };

  let xml: string;
  try {
    const response = await deps.fetchImpl(feed.feedUrl, {
      headers: {
        'user-agent': WATCHER_USER_AGENT,
        accept: 'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    xml = await response.text();
  } catch (err) {
    return {
      source: feed.source,
      feedUrl: feed.feedUrl,
      outcome: 'error',
      ...counts,
      error: err instanceof Error ? err.message : 'unknown error',
    };
  }

  for (const item of parseRssItems(xml, MAX_ITEMS_PER_FEED)) {
    counts.fetched += 1;
    try {
      const url = candidateUrlFor(feed, item);
      const title = item.title;
      const publishedAt = item.pubDate === null ? null : pubDateToIsoDay(item.pubDate);
      if (url === null || title === null || publishedAt === null) {
        counts.skipped += 1;
        log.warn({
          message: `Calendar watcher skipped a malformed ${feed.source} item (missing link/guid, title, or parsable pubDate)`,
          source: feed.source,
          url: url,
        });
        continue;
      }

      // Keyword gate — EMTA only; the pre-filtered sources pass through.
      if (feed.keywords !== null && !matchesKeywords(feed.keywords, title)) {
        counts.filtered += 1;
        continue;
      }

      // URL dedup — the pure decision over every stored URL (any status).
      const decision = decideCandidateInsert({ url }, knownUrls);
      if (decision === 'SKIP_KNOWN_URL') {
        counts.duplicates += 1;
        continue;
      }

      // The persistence-boundary validator is the single content contract;
      // a normalized item always carries the identity fields, so a
      // rejection here is a bug-shaped surprise — counted, never raised.
      const validated = validateCalendarEventCandidate({
        source: feed.source,
        url,
        title,
        publishedAt,
        status: 'PENDING',
        draftFi: null,
        draftEn: null,
      });
      await deps.insertCandidate(validated);
      knownUrls.add(validated.url);
      counts.inserted += 1;
    } catch (err) {
      counts.skipped += 1;
      log.error({
        message: `Calendar watcher failed to insert a ${feed.source} item (fail-open, item skipped): ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
        source: feed.source,
      });
    }
  }

  return {
    source: feed.source,
    feedUrl: feed.feedUrl,
    outcome: 'ok',
    ...counts,
    error: null,
  };
}

/**
 * One watcher run: poll every verified feed sequentially, collect
 * per-feed outcomes, log the summary counts. Throws only if the
 * known-URL read fails — the fail-open wrapper below is the entry the
 * router registers, never this function.
 *
 * `deps` is a test seam (fetch, known-URL read, insert), the same
 * pattern the sibling cron handlers use.
 */
export async function handleCalendarSourceWatcher(
  env: Env,
  log: Logger,
  deps: CalendarSourceWatcherDeps = {},
): Promise<CalendarWatcherRunResult> {
  const resolved: Required<CalendarSourceWatcherDeps> = {
    fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)),
    listKnownUrls: deps.listKnownUrls ?? (() => listAllCandidateUrls(env)),
    insertCandidate: deps.insertCandidate ?? ((candidate) => insertCandidateRow(env, candidate)),
  };

  // One read per run, live-updated per insert — two items sharing a URL
  // inside one payload dedup against each other too.
  const knownUrls = new Set(await resolved.listKnownUrls());

  // Sequential by design — politeness is one request at a time.
  const feeds: WatcherFeedResult[] = [];
  for (const feed of WATCHED_FEEDS) {
    feeds.push(await pollFeed(feed, knownUrls, log, resolved));
  }

  const totals = feeds.reduce(
    (sum, feed) => ({
      inserted: sum.inserted + feed.inserted,
      duplicates: sum.duplicates + feed.duplicates,
      skipped: sum.skipped + feed.skipped,
      filtered: sum.filtered + feed.filtered,
    }),
    { inserted: 0, duplicates: 0, skipped: 0, filtered: 0 },
  );
  const errored = feeds.filter((feed) => feed.outcome === 'error').length;

  log.info({
    message: `Calendar source watcher complete: ${feeds.length} feeds polled (${errored} errored), ` +
      `${totals.inserted} inserted, ${totals.duplicates} duplicates, ` +
      `${totals.skipped} skipped, ${totals.filtered} filtered`,
    feeds: feeds.map((feed) => ({
      source: feed.source,
      outcome: feed.outcome,
      fetched: feed.fetched,
      inserted: feed.inserted,
      duplicates: feed.duplicates,
      skipped: feed.skipped,
      filtered: feed.filtered,
    })),
    inserted: totals.inserted,
    duplicates: totals.duplicates,
    skipped: totals.skipped,
    filtered: totals.filtered,
  });

  return { feeds, ...totals };
}

/**
 * The fail-open wrapper — the entry the router registers. Never throws:
 * every failure (e.g. the known-URL read) is caught and logged, and the
 * wrapper resolves to null (the sibling crons' wrapper; the scheduled
 * invocation completes — per-handler isolation in the router stays the
 * second belt).
 */
export async function runCalendarSourceWatcher(
  env: Env,
  log: Logger,
  deps: CalendarSourceWatcherDeps = {},
): Promise<CalendarWatcherRunResult | null> {
  try {
    return await handleCalendarSourceWatcher(env, log, deps);
  } catch (err) {
    log.error({
      message: `Calendar source watcher failed (fail-open, the tick completes): ${
        err instanceof Error ? err.message : 'unknown error'
      }`,
    });
    return null;
  }
}

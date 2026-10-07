/**
 * Polite sequential product-page walker (task 1.1, change
 * sitemap-crawl-merchants; design D2).
 *
 * Walk discipline, pinned by the spec: detail pages are fetched one at
 * a time, with at least {@link MIN_REQUEST_SPACING_MS} between requests
 * to the same host, under a descriptive User-Agent, bounded by the URL
 * set handed in (itself bounded by the sitemap). The spacing is
 * injectable so tests run without real waits and the D5 chunking can
 * pace without re-implementing the rule.
 *
 * Failure discipline mirrors the shared WooCommerce walk
 * (`woo-store.adapter.ts`): page-level failures — network errors, HTTP
 * errors, unreadable bodies, a throwing page processor — accumulate in
 * `errors[]` and never abort the walk; a failed page costs one page,
 * not the run. The walker never throws for recoverable failures.
 *
 * The User-Agent identifies the platform honestly (design D2, risks):
 * it names the crawler and carries the operator URL, so a site admin
 * can tell who is polling at 1 req/s and reach a human.
 *
 * @module CrawlWalker
 */

import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

export const CRAWLER_USER_AGENT = 'rajahinta-crawler/1.0 (+https://rajahinta.fi)';

/** The self-imposed politeness floor — ≥ 1 s between same-host requests. */
export const MIN_REQUEST_SPACING_MS = 1000;

/** HTTP fetch port — injectable so tests (and Workers) supply the client. */
export type PageFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

/** Wall-clock delay port — injectable so tests never sleep for real. */
export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const defaultPageFetcher: PageFetcher = (url, init) => fetch(url, init);

/** What one page produced: zero or one record plus its collected errors. */
export interface CrawlPageOutcome {
  readonly record: RawFeedRecord | null;
  readonly errors?: readonly string[];
}

export type PageProcessor = (
  url: string,
  body: string,
) => CrawlPageOutcome | Promise<CrawlPageOutcome>;

export interface PageWalkOptions {
  /** Merchant id used to prefix page errors ("viinikauppa …"). */
  readonly errorLabel: string;
  /** The bounded URL set — never extended from inside the walker. */
  readonly urls: readonly string[];
  readonly processPage: PageProcessor;
  readonly fetcher: PageFetcher;
  readonly sleep: Sleep;
  readonly minSpacingMs?: number;
  /**
   * Hard cap on fetches for this walk (design D5's ≤ 300-fetch chunk).
   * The cap cuts the tail of the URL set; resumability across
   * invocations is the cursor's job (task 3.1).
   */
  readonly maxFetches?: number;
}

export interface PageWalkResult {
  readonly records: RawFeedRecord[];
  readonly errors: string[];
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export async function walkProductPages(
  options: PageWalkOptions,
): Promise<PageWalkResult> {
  const label = options.errorLabel;
  const minSpacingMs = options.minSpacingMs ?? MIN_REQUEST_SPACING_MS;
  const records: RawFeedRecord[] = [];
  const errors: string[] = [];

  let fetched = 0;
  for (const url of options.urls) {
    if (options.maxFetches !== undefined && fetched >= options.maxFetches) {
      break;
    }

    // The spacing sits before each request except the walk's first, so
    // consecutive request STARTS are ≥ minSpacingMs apart regardless of
    // how fast the server answers.
    if (fetched > 0) {
      await options.sleep(minSpacingMs);
    }
    fetched++;

    let response: Response;
    try {
      response = await options.fetcher(url, {
        headers: { 'user-agent': CRAWLER_USER_AGENT },
      });
    } catch (err) {
      errors.push(`${label} ${url} fetch failed: ${errorOf(err)}`);
      continue;
    }

    if (!response.ok) {
      errors.push(
        `${label} ${url} returned HTTP ${response.status}: ${response.statusText}`,
      );
      continue;
    }

    let body: string;
    try {
      body = await response.text();
    } catch (err) {
      errors.push(`${label} ${url} body read failed: ${errorOf(err)}`);
      continue;
    }

    try {
      const outcome = await options.processPage(url, body);
      if (outcome.record !== null) records.push(outcome.record);
      errors.push(...(outcome.errors ?? []));
    } catch (err) {
      errors.push(`${label} ${url} processing failed: ${errorOf(err)}`);
    }
  }

  return { records, errors };
}

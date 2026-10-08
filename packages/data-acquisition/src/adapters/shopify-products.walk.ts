/**
 * Shared Shopify products.json page-walk (task 2.1, change
 * onboard-shopify-lmdw-merchants; design D1).
 *
 * bottleofitaly and kuhns are both Shopify stores whose products.json
 * envelope is platform-fixed (`{ products: [...] }`), so the walk lives
 * here once from merchant one of two — the same platform-format argument
 * that justified the Woo walk at three (design D1: rule-of-three
 * formality deliberately waived). The merchant adapters become thin
 * subclasses that name only what genuinely differs per merchant: the
 * `merchantId` and the error-label prefix in page errors. Parsing stays
 * per-merchant (tasks 3.1/3.2): the walk strips only the raw page
 * envelope and hands the raw product rows to the {@link parseProducts}
 * hook — the Woo precedent of a shared walk plus thin subclasses, with
 * the parser step left open.
 *
 * Walk discipline (design D7 — rate-limit politeness is a walk
 * property): sequential requests, one page in flight, at the products.json
 * page-size maximum `limit=250` (fewest requests). Both Shopify stores
 * 429'd a rapid prober, so a failed page is a collected per-page error
 * and the run persists what succeeded — a throttled daily run degrades
 * instead of hammering. No retry/backoff machinery: the daily cadence is
 * the retry.
 *
 * Documented divergence from the Woo walk (design D1): Shopify
 * products.json exposes **no total-pages header** (no `X-WP-TotalPages`
 * equivalent), so the bound is **short-page termination** — a page
 * returning fewer products than `limit=250` is the last page. An empty
 * first page is a normal empty catalog; an empty page after non-empty
 * pages is a normal end; neither is an error. This is weaker than a
 * header bound (a catalog changing size mid-walk can extend or truncate
 * the walk by one page) — accepted because the products.json format is
 * Shopify-fixed and stable; the drift self-corrects on the next daily
 * run and the sweep's row-count reconciliation makes it visible.
 *
 * Because no header bounds the walk, a run of consecutive failed pages
 * (HTTP errors, network failures, unusable JSON, invalid envelopes)
 * would otherwise never terminate — every failed page yields no rows,
 * so short-page termination can never fire. The walk therefore stops
 * after {@link MAX_CONSECUTIVE_PAGE_FAILURES} consecutive failed pages:
 * the direct analogue of the Woo walk's never-an-unbounded-loop
 * guarantee. An isolated failure (the observed burst-429 shape) still
 * recovers — later pages are fetched and count; a source failing
 * persistently costs a bounded three requests, and whatever the
 * truncated walk missed is the next daily run's retry.
 *
 * Shopify has formally deprecated the `page` parameter: if the platform
 * kills it, every page past the first comes back empty and the walk
 * terminates immediately (loudly short, visible in reconciliation) —
 * the Storefront API migration is the named follow-up, out of scope.
 *
 * @module ShopifyProductsWalk
 */

import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';

/** Shopify products.json page-size maximum — also the walk's fixed page
 * size and its short-page termination threshold. */
const PAGE_LIMIT = 250;

/**
 * Consecutive failed pages tolerated before the walk stops — the
 * short-page bound's never-unbounded guarantee (see module docblock).
 */
const MAX_CONSECUTIVE_PAGE_FAILURES = 3;

/**
 * The per-merchant knobs of the walk — everything else is identical.
 * The collection path is NOT a knob: `/products.json` is mounted at the
 * same path on every Shopify store, appended to the trailing-slash-
 * stripped registry feedUrl.
 */
export interface ShopifyWalkOptions {
  /**
   * Error-label prefix in page errors — 'bottleofitaly' produces
   * "bottleofitaly page 2 returned HTTP 429: Too Many Requests".
   */
  readonly errorLabelPrefix: string;
}

/** `{ products: [...] }` → the rows array; anything else → null. */
function productsOf(payload: unknown): unknown[] | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const products = (payload as { products?: unknown }).products;
  return Array.isArray(products) ? products : null;
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/**
 * The merchant-agnostic products.json walk. Subclasses pin `merchantId`
 * and implement {@link parseProducts} with their sweep-proven parser;
 * `fetch` behavior is shared verbatim so both merchants' golden
 * fixtures pin one walk.
 */
export abstract class ShopifyProductsFeedAdapter implements IFeedAdapter {
  abstract readonly merchantId: string;

  private readonly walkOptions: ShopifyWalkOptions;

  protected constructor(walkOptions: ShopifyWalkOptions) {
    this.walkOptions = walkOptions;
  }

  /**
   * Fetch the full catalog from the configured feed URL and map it to
   * canonical records. Page-level failures are collected per page and
   * never thrown; the walk's errors precede the hook's row errors.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    const { records: rows, errors } = await this.walkProducts(config);
    const { records, errors: rowErrors } = this.parseProducts(rows);
    return { records, errors: [...errors, ...rowErrors] };
  }

  /**
   * The per-merchant parser hook — the rows of every successful page,
   * in page order, exactly as products.json delivered them. Tasks
   * 3.1/3.2 implement this with the sweep-proven extraction; row-level
   * corrections accumulate in `errors[]` per the adapter contract, as
   * `parseAlksStoreProducts` does for the Woo walk.
   */
  protected abstract parseProducts(
    rows: readonly unknown[],
  ): { records: RawFeedRecord[]; errors: string[] };

  /**
   * Walk the pages and collect the raw product rows plus per-page
   * errors — the envelope is the only shape this method parses.
   */
  private async walkProducts(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: unknown[]; errors: string[] }> {
    const label = this.walkOptions.errorLabelPrefix;
    const records: unknown[] = [];
    const errors: string[] = [];
    const productsUrl = `${config.feedUrl.replace(/\/+$/, '')}/products.json`;

    let consecutiveFailures = 0;

    // No header bound exists (design D1 divergence): the loop ends only
    // through short-page termination or the consecutive-failure cap.
    for (let page = 1; ; page++) {
      let response: Response;
      try {
        response = await fetch(
          `${productsUrl}?limit=${PAGE_LIMIT}&page=${page}`,
        );
      } catch (err) {
        errors.push(`${label} page ${page} fetch failed: ${errorOf(err)}`);
        if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) break;
        continue;
      }

      if (!response.ok) {
        // A 429 page is a failure, not a short page — keep walking (the
        // daily cadence is the retry) under the consecutive-failure cap.
        errors.push(
          `${label} page ${page} returned HTTP ${response.status}: ${response.statusText}`,
        );
        if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) break;
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        errors.push(`${label} page ${page} returned invalid JSON: ${errorOf(err)}`);
        if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) break;
        continue;
      }

      const products = productsOf(payload);
      if (products === null) {
        errors.push(
          `${label} page ${page} returned an invalid products.json envelope ` +
            `(no products array)`,
        );
        if (++consecutiveFailures >= MAX_CONSECUTIVE_PAGE_FAILURES) break;
        continue;
      }

      consecutiveFailures = 0;
      records.push(...products);

      // Short-page termination (design D1): fewer than a full page is
      // the last page — an empty first page is an empty catalog, an
      // empty later page the normal end. Never an error.
      if (products.length < PAGE_LIMIT) break;
    }

    return { records, errors };
  }
}

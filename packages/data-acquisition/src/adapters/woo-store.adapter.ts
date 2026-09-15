/**
 * Shared WooCommerce Store API page-walk (task 2.2, change
 * onboard-kippis-merchant; design D1 — rule of three reached).
 *
 * alks (alks-feed-and-import-vat), longero (onboard-longero-merchant),
 * and kippis (this change) each proved to be the identical walk over a
 * WooCommerce Store API collection whose payload the shared parser
 * (`parseAlksStoreProducts`) already handles, so the walk lives here
 * once and the three adapters become thin subclasses that name only
 * what genuinely differs per merchant: the `merchantId`, the error-label
 * prefix in page errors, and the collection URL path.
 *
 * Walk discipline (alks design D2, preserved verbatim): sequential
 * requests, `per_page=100`, one page at a time so a scheduled job never
 * hammers the store. The first response's `X-WP-TotalPages` header caps
 * the walk; a malformed or missing header stops after the current page
 * with an error — never an unbounded loop. Page-level failures (HTTP
 * errors, network failures, unusable JSON) accumulate in `errors[]` per
 * the adapter contract and never abort the walk: a failed page costs
 * one page, not the run, and records from successful pages are still
 * returned. The walk never throws for recoverable failures, and the
 * parser's per-row correction discipline passes through untouched.
 *
 * EUR-native with no FX conversion — a non-EUR row is rejected per-row
 * by the parser (Posti precedent), not converted here.
 *
 * @module WooStoreWalk
 */

import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { parseAlksStoreProducts } from './alks.parser';

/** Store API page size maximum — also the walk's fixed page size. */
const PER_PAGE = 100;

/**
 * The Store API collection path every merchant here shares, appended to
 * the registry feedUrl. Subclasses pass it explicitly so the walk stays
 * parameterized for a future store that mounts WooCommerce elsewhere.
 */
export const WOO_STORE_API_PATH = '/wp-json/wc/store/v1/products';

/** The per-merchant knobs of the walk — everything else is identical. */
export interface WooStoreWalkOptions {
  /**
   * Error-label prefix in page errors — 'alks' produces
   * "alks page 2 fetch failed: …".
   */
  readonly errorLabelPrefix: string;
  /** Collection path appended to the trailing-slash-stripped feedUrl. */
  readonly storeApiPath: string;
}

/** '29' → 29; anything else (missing, empty, non-numeric) → null. */
function parseTotalPagesHeader(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function errorOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/**
 * The merchant-agnostic Store API walk. Subclasses pin `merchantId` and
 * hand the constructor their walk options; `fetch` behavior is shared
 * verbatim so the golden fixtures of all three merchants pin one walk.
 */
export abstract class WooStoreFeedAdapter implements IFeedAdapter {
  abstract readonly merchantId: string;

  private readonly walkOptions: WooStoreWalkOptions;

  protected constructor(walkOptions: WooStoreWalkOptions) {
    this.walkOptions = walkOptions;
  }

  /**
   * Fetch the full catalog from the configured feed URL and map it to
   * canonical records. Errors are collected per page and per row;
   * never thrown for recoverable failures.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    const label = this.walkOptions.errorLabelPrefix;
    const records: RawFeedRecord[] = [];
    const errors: string[] = [];
    const collectionUrl =
      `${config.feedUrl.replace(/\/+$/, '')}${this.walkOptions.storeApiPath}`;

    // D2: the first usable X-WP-TotalPages header caps the walk. null
    // means "no bound yet" — a walk that cannot gain a bound stops after
    // its current page instead of running on unbounded.
    let totalPages: number | null = null;

    for (let page = 1; totalPages === null || page <= totalPages; page++) {
      let response: Response;
      try {
        response = await fetch(
          `${collectionUrl}?per_page=${PER_PAGE}&page=${page}`,
        );
      } catch (err) {
        errors.push(`${label} page ${page} fetch failed: ${errorOf(err)}`);
        if (totalPages === null) break;
        continue;
      }

      if (totalPages === null) {
        const raw = response.headers.get('X-WP-TotalPages');
        const parsed = parseTotalPagesHeader(raw);
        if (parsed === null) {
          // D2: a malformed or missing header stops the walk after the
          // current page — its records still count, but the walk cannot
          // continue safely without a bound.
          errors.push(
            `${label} page ${page} response has no usable X-WP-TotalPages header ` +
              `(${raw === null ? 'missing' : `"${raw}"`}) — stopping after this page`,
          );
          totalPages = page;
        } else {
          totalPages = parsed;
        }
      }

      if (!response.ok) {
        errors.push(
          `${label} page ${page} returned HTTP ${response.status}: ${response.statusText}`,
        );
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        errors.push(`${label} page ${page} returned invalid JSON: ${errorOf(err)}`);
        continue;
      }

      const { records: pageRecords, errors: pageErrors } =
        parseAlksStoreProducts(payload);
      records.push(...pageRecords);
      errors.push(...pageErrors);
    }

    return { records, errors };
  }
}

/**
 * longero.fi feed adapter (task 2.1, change onboard-longero-merchant).
 *
 * A thin mirror of the alks adapter (`alks.adapter.ts`): longero.fi is
 * a WooCommerce Store API whose payload is field-for-field compatible
 * with alks's (EAN-shaped SKUs, EUR minor-unit prices, name-embedded
 * ABV/volume, `X-WP-TotalPages` pagination), so the walk discipline is
 * the same verbatim and every row is fed through the existing parser
 * (`parseAlksStoreProducts`, reused unchanged — no parser rename or
 * extraction; rule of three: generalization waits for a third
 * WooCommerce merchant).
 *
 * Walk discipline (alks design D2): sequential requests,
 * `per_page=100`, one page at a time. The first response's
 * `X-WP-TotalPages` header caps the walk; a malformed or missing header
 * stops after the current page with an error — never an unbounded loop.
 * Page-level failures (HTTP errors, network failures, unusable JSON)
 * accumulate in `errors[]` per the adapter contract and never abort the
 * walk: a failed page costs one page, not the run. The adapter never
 * throws for recoverable failures, and the parser's per-row correction
 * discipline passes through untouched.
 *
 * Scraping rights: documented — governance source `RETAILER_API`
 * (public WooCommerce Store API). The merchant is operated by
 * TOVAGLUKE OÜ (Estonia; registry country `EE` — the `.fi` domain is
 * misleading), and fetching stays gated behind a `GRANTED` governance
 * record. Foreign-merchant tax model: EUR-native with no FX conversion
 * — a non-EUR row is rejected per-row by the parser (Posti precedent),
 * not converted here.
 *
 * @module LongeroFeedAdapter
 */

import type { IFeedAdapter, RawFeedRecord } from '../interfaces/feed-adapter.interface';
import { parseAlksStoreProducts } from './alks.parser';

/** Store API page size maximum — also the walk's fixed page size. */
const PER_PAGE = 100;

/** The Store API collection path, appended to the registry feedUrl. */
const STORE_API_PATH = '/wp-json/wc/store/v1/products';

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

export class LongeroFeedAdapter implements IFeedAdapter {
  readonly merchantId = 'longero';

  /**
   * Fetch the full longero.fi catalog from the configured feed URL and
   * map it to canonical records. Errors are collected per page and per
   * row; never thrown for recoverable failures.
   */
  async fetch(
    config: { feedUrl: string; feedFormat: 'json' | 'xml' | 'csv' },
  ): Promise<{ records: RawFeedRecord[]; errors: string[] }> {
    const records: RawFeedRecord[] = [];
    const errors: string[] = [];
    const collectionUrl =
      `${config.feedUrl.replace(/\/+$/, '')}${STORE_API_PATH}`;

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
        errors.push(`longero page ${page} fetch failed: ${errorOf(err)}`);
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
            `longero page ${page} response has no usable X-WP-TotalPages header ` +
              `(${raw === null ? 'missing' : `"${raw}"`}) — stopping after this page`,
          );
          totalPages = page;
        } else {
          totalPages = parsed;
        }
      }

      if (!response.ok) {
        errors.push(
          `longero page ${page} returned HTTP ${response.status}: ${response.statusText}`,
        );
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        errors.push(`longero page ${page} returned invalid JSON: ${errorOf(err)}`);
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

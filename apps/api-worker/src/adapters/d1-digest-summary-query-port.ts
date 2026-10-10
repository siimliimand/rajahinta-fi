/**
 * D1 adapter for the digest module's {@link DigestSummaryQueryPort}
 * (task 4.2, change add-onboarding-preferences; design D4) — the wiring
 * the pure computation expects at the Worker's composition root: the
 * port contract lives in core-domain beside the facts it feeds, this
 * adapter owns the SQL.
 *
 * The read mirrors the summary repository's CATEGORY_MIN_SQL semantics
 * one row-set wider: product-wide daily buckets only (`merchant IS
 * NULL`), joined into `product_master` for the canonical category, over
 * the closed [fromDay, toDay] window — the same source CATEGORY alert
 * evaluation reads, so the digest and the alerts can never disagree
 * about what the materialized record says. The merchant column is
 * carried through (always null here) only because the fact citation is
 * typed to echo it.
 *
 * The query lives here rather than as a new method on the summary
 * repository because the digest is the query's only consumer and the
 * repository's contract stays bucket-shaped; the account-preference
 * enumeration read is the same narrowness rule applied to consent rows.
 *
 * @module D1DigestSummaryQueryPort
 */

import type {
  DigestCategory,
  DigestSummaryQuery,
  DigestSummaryQueryPort,
  DigestSummaryRow,
} from '../../../../packages/core-domain/src/digest/digest.types';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Raw joined row — the five columns a cited fact needs. */
interface D1DigestSummaryRow {
  readonly category: string;
  readonly product_id: number;
  readonly merchant: string | null;
  readonly period_start: string;
  readonly price_close_cents: number;
}

const DIGEST_SUMMARY_SQL = `
  SELECT p.category AS category,
         s.product_id AS product_id,
         s.merchant AS merchant,
         s.period_start AS period_start,
         s.price_close_cents AS price_close_cents
    FROM price_history_summaries s
    JOIN product_master p ON p.id = s.product_id
   WHERE s.granularity = 'daily'
     AND s.merchant IS NULL
     AND s.period_start >= ? AND s.period_start <= ?
     AND p.category IN (`; // category placeholders appended per call

/**
 * Build the {@link DigestSummaryQueryPort} over a D1 binding. One query
 * per call — the categories are the calling account's followed tags, so
 * the IN-list is per-sweep-per-account by design (a weekly cron over
 * consented accounts, not a hot path).
 */
export function createD1DigestSummaryQueryPort(
  d1: D1DatabaseLike,
): DigestSummaryQueryPort {
  return async (
    query: DigestSummaryQuery,
  ): Promise<readonly DigestSummaryRow[]> => {
    const { categories, fromDay, toDay } = query;
    // No followed tag → nothing to read; an empty IN () is also invalid
    // SQL, so the guard is load-bearing.
    if (categories.length === 0) {
      return [];
    }
    const placeholders = categories.map(() => '?').join(', ');
    const rows = (
      await d1
        .prepare(`${DIGEST_SUMMARY_SQL}${placeholders})`)
        .bind(fromDay, toDay, ...categories)
        .all<D1DigestSummaryRow>()
    ).results;
    return rows.map((row) => ({
      category: row.category as DigestCategory,
      productId: row.product_id,
      merchant: row.merchant,
      periodStart: row.period_start,
      priceCloseCents: row.price_close_cents,
    }));
  };
}

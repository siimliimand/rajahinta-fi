/**
 * Pure preference-digest computation — per-category factual facts over
 * materialized daily summaries (spec: preference-digest, design D1/D4).
 *
 * Every function here is deterministic and side-effect free: the facts
 * are derived from summary rows the caller already fetched (the
 * {@link DigestSummaryQueryPort} adapter in the digest cron), and nothing
 * is persisted, read, or dispatched here. No clock — the freshness window
 * is entirely the caller's concern: the module treats "no bucket in the
 * provided rows" as omission. No ranking, benchmark, savings, or
 * commercial-signal input exists on any code path (design D1).
 *
 * Stated facts, exactly two per category — nothing beyond them:
 *
 * - `CATEGORY_MINIMUM`: the category's minimum shelf price over the
 *   provided window, citing its product and merchant. Selected by the
 *   same total order the summary repository's category-minimum query
 *   uses — close ascending, product id ascending — so the digest and
 *   CATEGORY alert evaluation can never disagree about "the minimum"
 *   (design D4: one definition of current).
 * - `NOTABLE_NEW_LOW`: the simple, deterministic new-low rule. Let the
 *   latest day be the maximum `periodStart` among the category's rows;
 *   the rule compares the fresh end (rows on the latest day) with the
 *   earlier part of the window (rows strictly before it): the fact
 *   exists iff the earlier part is non-empty AND the fresh end's minimum
 *   (same total order) is STRICTLY lower than the earlier part's
 *   minimum. The fact cites the fresh end's tripping row. A window that
 *   is one single day has no earlier part and never yields a new low;
 *   equal or higher fresh-end minima yield none. When a new low exists
 *   it is by definition the window minimum, so the category then carries
 *   both facts at the same price — the kind tiebreaker in the ordering
 *   keeps the pair deterministic.
 *
 * Filtering and omission: only followed tags' categories can appear
 * (the preference is a filter, design D1); a followed category with no
 * provided rows is omitted — never reported as zero or stale (design
 * D4). An empty output array is the send-nothing signal: the cron skips
 * the account entirely, writing no intent row.
 *
 * @module DigestCompute
 */

import { sortDigestFacts } from './ordering';
import {
  DIGEST_CATEGORY_VALUES,
  InvalidDigestInputError,
  type DigestCategory,
  type DigestFact,
  type DigestSummaryRow,
  type PreferenceDigestInput,
} from './digest.types';

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute the digest facts for one account's followed categories over the
 * provided summary rows.
 *
 * ```
 * output = for each followed category with ≥ 1 provided row:
 *            CATEGORY_MINIMUM fact  (always)
 *            NOTABLE_NEW_LOW fact   (rule above; often absent)
 *          ordered category asc, then price asc
 * ```
 *
 * Output is sorted by {@link sortDigestFacts} — category ascending, then
 * price ascending, deterministic tiebreaks. Two computations over equal
 * inputs produce item-for-item identical arrays regardless of input row
 * order or runtime.
 *
 * Validation policy (caller contract violations throw
 * {@link InvalidDigestInputError}, mirroring the price-context module):
 * every tag and row category must be in the canonical value set, every
 * price close must be an integer > 0 (a bucket exists only where
 * observations exist), every product id an integer, every bucket day a
 * non-empty string. A NaN or fractional price would silently break the
 * comparator's determinism, which is why malformed input fails loudly
 * rather than shaping itself into a display state.
 *
 * Pure — no I/O, no clock, zero persistence; the input arrays are never
 * mutated.
 *
 * @param input See {@link PreferenceDigestInput}.
 * @returns The digest facts in stated order; empty when nothing is
 *          reportable — the caller sends nothing.
 */
export function computePreferenceDigest(
  input: PreferenceDigestInput,
): readonly DigestFact[] {
  const followed = followedTagsOf(input.categoryTags);
  if (followed.size === 0) {
    return [];
  }

  // Group the provided rows by category, keeping followed categories
  // only — the preference filter. Unfollowed rows are dropped silently;
  // a followed category that simply has no rows never materializes here
  // (omission, design D4).
  const rowsByCategory = new Map<DigestCategory, DigestSummaryRow[]>();
  for (const row of input.summaryRows) {
    assertValidRow(row);
    if (!followed.has(row.category)) {
      continue;
    }
    const rows = rowsByCategory.get(row.category);
    if (rows) {
      rows.push(row);
    } else {
      rowsByCategory.set(row.category, [row]);
    }
  }

  const facts: DigestFact[] = [];
  for (const [category, rows] of rowsByCategory) {
    const minimum = minimumOf(rows);
    facts.push({ category, kind: 'CATEGORY_MINIMUM', ...minimum });
    const newLow = newLowOf(rows);
    if (newLow) {
      facts.push({ category, kind: 'NOTABLE_NEW_LOW', ...newLow });
    }
  }

  return sortDigestFacts(facts);
}

// ---------------------------------------------------------------------------
// Per-category fact selection
// ---------------------------------------------------------------------------

/** Total order on rows for "the minimum": close ascending, product id ascending — the category-minimum query's `ORDER BY price_close_cents ASC, product_id ASC LIMIT 1`. */
function cheaperOf(a: DigestSummaryRow, b: DigestSummaryRow): DigestSummaryRow {
  if (a.priceCloseCents !== b.priceCloseCents) {
    return a.priceCloseCents < b.priceCloseCents ? a : b;
  }
  return a.productId <= b.productId ? a : b;
}

function minimumOf(rows: readonly DigestSummaryRow[]): Omit<
  DigestFact,
  'category' | 'kind'
> {
  let cheapest = rows[0];
  for (const row of rows) {
    cheapest = cheaperOf(row, cheapest);
  }
  return {
    priceCloseCents: cheapest.priceCloseCents,
    productId: cheapest.productId,
    merchant: cheapest.merchant,
    periodStart: cheapest.periodStart,
  };
}

/**
 * The new-low rule (documented on {@link computePreferenceDigest}): the
 * latest day's minimum, when strictly below the earlier part's minimum.
 */
function newLowOf(
  rows: readonly DigestSummaryRow[],
): Omit<DigestFact, 'category' | 'kind'> | null {
  let latestDay = rows[0].periodStart;
  for (const row of rows) {
    if (row.periodStart > latestDay) {
      latestDay = row.periodStart;
    }
  }

  let earlierMinimum: DigestSummaryRow | null = null;
  let freshEndMinimum: DigestSummaryRow | null = null;
  for (const row of rows) {
    if (row.periodStart < latestDay) {
      earlierMinimum = earlierMinimum ? cheaperOf(row, earlierMinimum) : row;
    } else {
      freshEndMinimum = freshEndMinimum
        ? cheaperOf(row, freshEndMinimum)
        : row;
    }
  }

  // No earlier part → nothing to be lower than; never a new low.
  if (!earlierMinimum || !freshEndMinimum) {
    return null;
  }
  if (freshEndMinimum.priceCloseCents >= earlierMinimum.priceCloseCents) {
    return null;
  }
  return {
    priceCloseCents: freshEndMinimum.priceCloseCents,
    productId: freshEndMinimum.productId,
    merchant: freshEndMinimum.merchant,
    periodStart: freshEndMinimum.periodStart,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The followed tags as a set — duplicates collapsed, membership enforced. */
function followedTagsOf(
  categoryTags: readonly DigestCategory[],
): Set<DigestCategory> {
  const followed = new Set<DigestCategory>();
  for (const tag of categoryTags) {
    assertValidCategory(tag, 'categoryTags');
    followed.add(tag);
  }
  return followed;
}

function assertValidCategory(
  category: DigestCategory,
  field: string,
): void {
  if (!(DIGEST_CATEGORY_VALUES as readonly string[]).includes(category)) {
    throw new InvalidDigestInputError(
      `${field} must be one of ${DIGEST_CATEGORY_VALUES.join(', ')}, got ${String(category)}`,
    );
  }
}

function assertValidRow(row: DigestSummaryRow): void {
  assertValidCategory(row.category, 'summaryRows[].category');
  if (!Number.isInteger(row.productId)) {
    throw new InvalidDigestInputError(
      `summaryRows[].productId must be an integer, got ${String(row.productId)}`,
    );
  }
  if (!Number.isInteger(row.priceCloseCents) || row.priceCloseCents <= 0) {
    throw new InvalidDigestInputError(
      `summaryRows[].priceCloseCents must be an integer > 0, got ${String(row.priceCloseCents)}`,
    );
  }
  if (typeof row.periodStart !== 'string' || row.periodStart.length === 0) {
    throw new InvalidDigestInputError(
      'summaryRows[].periodStart must be a non-empty ISO date string',
    );
  }
}

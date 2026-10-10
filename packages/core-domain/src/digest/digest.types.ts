/**
 * Preference-digest types — the factual facts of the weekly digest email
 * (spec: preference-digest, design D1/D4).
 *
 * The module is pure: these types are its OWN contracts, shaped to be
 * structurally compatible with the materialized daily-summary rows the
 * D1 `price_history_summaries` repository reads (the same buckets
 * CATEGORY alert evaluation reads), so the digest cron can map records
 * straight in — without this module importing any database, repository,
 * or I/O code. Only the five fields a cited fact needs are declared
 * (category, product, merchant, bucket day, shelf-price close); the
 * remaining summary columns (open/min/max/avg, landed-cost aggregates,
 * reliability) are ignored by structure.
 *
 * Preferences appear here ONLY as the category-tag filter (design D1:
 * a preference narrows the candidate set, never the order, never the
 * facts). No ranking, benchmark, savings, or commercial-signal field
 * exists on any input or output type — the neutrality boundary the
 * compliance suite pins.
 *
 * @module DigestTypes
 */

// ---------------------------------------------------------------------------
// Canonical vocabulary — mirrors the canonical product-category value set.
// Declared here, not imported: purity forbids a data-platform import.
// ---------------------------------------------------------------------------

/**
 * Product categories — the canonical tax-rule category keys
 * (`product_master.category`), so the digest's per-category facts feed
 * the email builder without a translation layer. Value set mirrors
 * `PRODUCT_CATEGORIES` in the data-platform schema; the repository/route
 * layer remains the single validation point (design D7) — this module
 * only rejects values outside the set as caller contract violations.
 */
export const DIGEST_CATEGORY_VALUES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'other_fermented',
  'spirits',
] as const;

export type DigestCategory = (typeof DIGEST_CATEGORY_VALUES)[number];

// ---------------------------------------------------------------------------
// Input rows — the already-fetched summary reads
// ---------------------------------------------------------------------------

/**
 * One materialized daily-summary bucket as the digest consumes it. Fields
 * mirror the D1 summary contract 1:1 (`product_id`, `merchant`,
 * `period_start`, `price_close_cents`) plus the product's canonical
 * category from `product_master` — the join is the caller's concern (the
 * repository's category-minimum query joins the same way).
 *
 * The caller supplies the product-wide daily series (merchant-null rows,
 * the read the category-minimum query performs) inside the closed
 * 7-day freshness window; freshness and windowing are the caller's
 * concern (design D4). The module is merchant-agnostic: `merchant` is
 * carried through only as the fact's citation.
 */
export interface DigestSummaryRow {
  /** The product's canonical category (`product_master.category`). */
  readonly category: DigestCategory;
  /** Summary `product_id` — the fact's product citation. */
  readonly productId: number;
  /** Summary `merchant` — the fact's merchant citation (`null` = product-wide bucket). */
  readonly merchant: string | null;
  /** Summary `period_start` — the bucket's whole-day anchor (ISO `YYYY-MM-DD`). */
  readonly periodStart: string;
  /** Summary `price_close_cents` — the shelf-price figure every fact cites, euro cents. */
  readonly priceCloseCents: number;
}

// ---------------------------------------------------------------------------
// Fetch port — the contract the digest cron implements, not calls
// ---------------------------------------------------------------------------

/** Window a port implementation reads: the closed `[fromDay, toDay]` daily range per category, the same closed-range semantics as the summary repository's range read. */
export interface DigestSummaryQuery {
  /** Followed categories to read. */
  readonly categories: readonly DigestCategory[];
  /** Window start, inclusive (ISO `YYYY-MM-DD` whole-day anchor). */
  readonly fromDay: string;
  /** Window end, inclusive (ISO `YYYY-MM-DD` whole-day anchor). */
  readonly toDay: string;
}

/**
 * The fetch contract the digest cron (change add-onboarding-preferences,
 * task 4.2) implements against the D1 summary repository — declared here
 * so the wiring target lives beside the facts it feeds. Daily granularity
 * only (design D4: a weekly email needs no other bucket size).
 *
 * The pure computation NEVER calls this port: it consumes the rows the
 * adapter already fetched, passed as {@link PreferenceDigestInput.summaryRows}.
 */
export type DigestSummaryQueryPort = (
  query: DigestSummaryQuery,
) => Promise<readonly DigestSummaryRow[]>;

// ---------------------------------------------------------------------------
// Computation input
// ---------------------------------------------------------------------------

/** Inputs of the digest computation: the preference filter plus the fetched reads. */
export interface PreferenceDigestInput {
  /**
   * Followed category tags — the preference filter (design D1). Duplicates
   * are collapsed; order is irrelevant (tags never influence order).
   */
  readonly categoryTags: readonly DigestCategory[];
  /**
   * Already-fetched daily-summary rows for the freshness window, any
   * order — the module sorts. Rows outside {@link PreferenceDigestInput.categoryTags}
   * are ignored (the filter), so the caller may read broadly or narrowly.
   */
  readonly summaryRows: readonly DigestSummaryRow[];
}

// ---------------------------------------------------------------------------
// Output facts
// ---------------------------------------------------------------------------

/**
 * Which stated fact an item is — the only two figures the digest asserts
 * (spec "Factual content"): the category's minimum shelf price in the
 * window, and the notable new low. No statistics beyond these two exist.
 */
export type DigestFactKind = 'CATEGORY_MINIMUM' | 'NOTABLE_NEW_LOW';

/**
 * One cited, factual digest item: a shelf price with its product and
 * merchant, anchored to the bucket day it was observed on. Pure echo of
 * summary fields — the email builder renders these verbatim, so no
 * superlative or promotional framing can attach here (design D3).
 */
export interface DigestFact {
  /** The category the fact belongs to (a followed tag with fresh buckets). */
  readonly category: DigestCategory;
  /** Which stated fact this is. */
  readonly kind: DigestFactKind;
  /** The shelf price in euro cents (the summary close the fact cites). */
  readonly priceCloseCents: number;
  /** Product citation, echoed from the tripping summary row. */
  readonly productId: number;
  /** Merchant citation, echoed from the tripping summary row (`null` = product-wide). */
  readonly merchant: string | null;
  /** Bucket day the fact was observed on (ISO `YYYY-MM-DD`). */
  readonly periodStart: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Thrown when an input violates the module's contract — a value outside
 * the canonical category set, a non-integer or non-positive price, a
 * non-integer product id, or an empty bucket day. Mirrors
 * `InvalidPriceContextInputError`: a malformed input is a caller bug, so
 * it fails loudly instead of shaping itself into a display state (and a
 * NaN price in particular would silently break the deterministic
 * comparator — the ordering invariant the spec pins).
 */
export class InvalidDigestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDigestInputError';
  }
}

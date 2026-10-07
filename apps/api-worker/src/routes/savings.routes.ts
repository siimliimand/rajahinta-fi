/**
 * Savings discovery routes (spec savings-discovery) — the per-category
 * listing GET /api/v1/savings (task 2.3, change insight-surfaces), the
 * cross-category overview GET /api/v1/savings/overview, the
 * cross-category top-N GET /api/v1/savings/top (task 1.1, change
 * homepage-live-gap-hero; 3-day eligible-day fallback, change
 * savings-top-day-fallback), and the best deal per cross-border merchant
 * GET /api/v1/savings/best-per-merchant (task 1.3, change
 * savings-first-catalog-and-prefill).
 *
 * Public, deterministic listing of the daily materialized snapshot rows
 * for ONE category, ordered by the core-domain sortSavingsRows rule
 * (gap basis points ascending — the largest saving first — product name
 * ascending, product id as the final tie). Guard chain (allowances
 * parity): ageGate() per-route plus the route-local SAVINGS limiter.
 *
 * ## Coverage counts — derivation decision
 *
 * The snapshot table holds rows only for products that qualified on the
 * materialization day (an Alko reference with an observation timestamp
 * AND a computed gap), so the funnel's top is not queryable from the
 * snapshots alone. The three counts are sourced, never guessed:
 *
 * - `evaluated` — the products the materialization pass enumerates,
 *   sourced as the product registry count through the search
 *   repository's full listing (the repository documents the ~10⁴-row
 *   fetch-then-slice shape as safe; the repository contract exposes no
 *   COUNT, and the route invents no cheaper approximation). The same
 *   fetch builds the product-name map the deterministic ordering
 *   requires — one read, two uses.
 * - `withReference` — the snapshot rows materialized for the latest
 *   as-of day (rows exist only for products with a usable reference).
 * - `listed` — the rows returned for the requested category after
 *   ordering and the limit clamp.
 *
 * ## Category and rows
 *
 * `category` is required and matched verbatim against the stored
 * category (rows store the category exactly as the product registry
 * writes it; no case mapping is invented here). The pass never writes
 * rows for products without a usable reference, so a defensively
 * omitted row (missing reference or a product name no longer resolvable
 * from the registry) is stale data — it is excluded before ordering and
 * counting, never guessed into a position. An unknown category returns
 * 200 with an empty list and the counts — never an error.
 *
 * ## Best per merchant — derivation decision
 *
 * One row per cross-border merchant: the argmax of the objective
 * magnitude |gapCents| over that merchant's day rows, ties broken by
 * productId ascending — the same fixed selection the overview applies
 * to its largestDifference, regrouped by best-offer merchant instead of
 * category. No editorial picks, no registration step: a newly onboarded
 * merchant appears when its rows materialize. Merchant `alko` is
 * excluded — the domestic reference is the comparison side of every
 * stored gap, not a deal provider; a self-comparison is not a
 * cross-border saving.
 *
 * @module SavingsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// Direct source imports, route-file parity (search/allowances.routes) —
// wrangler aliases the @rajahinta/core-domain barrel to the bridge module,
// which re-exports only the pipeline's runtime closure.
import { sortSavingsRows } from '../../../../packages/core-domain/src/savings/ordering';
import type { SavingsGapValue } from '../../../../packages/core-domain/src/savings/savings.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';
import { requireRateLimit } from '../middleware/rate-limit';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1SavingsSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotRecord } from '../../../../packages/data-platform/src/abstracts';

/** Rows returned when the client sends no limit (listing-page scale). */
const DEFAULT_LIMIT = 200;
/** Hard cap — the listing is a discovery surface, not a bulk export. */
const MAX_LIMIT = 500;
/** Top-N rows returned when the client sends no limit (hero scale). */
const TOP_DEFAULT_LIMIT = 5;
/** Hard cap — the top-N is a homepage hero surface, not a bulk export. */
const TOP_MAX_LIMIT = 25;
/**
 * How many recent snapshot days the top-N may consult when the maximal
 * day holds no eligible row (change savings-top-day-fallback) — the
 * fallback walks this many distinct as_of days, newest first.
 */
const TOP_LOOKBACK_DAYS = 3;

/**
 * Largest observed cross-border difference within one candidate group —
 * the objective euro delta |gapCents| (the sign carries the direction,
 * the absolute value the magnitude), with the fixed deterministic
 * tie-break of productId ascending. The overview groups per category,
 * best-per-merchant per merchant; both select with this argmax. No
 * editorial picks, no trending, no boost: the same input always selects
 * the same row.
 */
function selectLargestDifference(
  candidates: readonly (SavingsSnapshotRecord & {
    alkoReferenceCents: number;
    productName: string;
  })[],
): (SavingsSnapshotRecord & {
  alkoReferenceCents: number;
  productName: string;
}) | null {
  let best: (SavingsSnapshotRecord & {
    alkoReferenceCents: number;
    productName: string;
  }) | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const magnitude = Math.abs(candidate.gapCents);
    const bestMagnitude = Math.abs(best.gapCents);
    if (
      magnitude > bestMagnitude ||
      (magnitude === bestMagnitude && candidate.productId < best.productId)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Cross-category market overview (task 5.2, change
 * price-intelligence-roadmap) — GET /api/v1/savings/overview.
 *
 * Deterministic aggregates over the same single-day snapshot read as the
 * listing, per category, over rows with sufficient data only (a computed
 * reference AND a product name the registry still resolves — the
 * listing's staleness defense):
 *
 *  - `averageObservedPriceCents` — the mean of the day's best observed
 *    foreign prices, in integer euro-cents (Math.round on the exact
 *    integer sum; no floats in the aggregate).
 *  - `largestDifference` — the row with the largest |gapCents|, ties
 *    broken by productId ascending (see
 *    {@link selectLargestDifference}); the signed figures travel along so
 *    the client can state cheaper/dearer explicitly.
 *  - `productCount` — the qualifying rows aggregated.
 *
 * A category with no qualifying rows is omitted — an empty aggregate is
 * never manufactured. Categories sort by code-unit name ascending and the
 * JSON key order is fixed by construction: the same D1 state yields a
 * byte-identical body on every request. Read-only, behind the same
 * per-route age gate and the SAVINGS limiter as the listing.
 */
async function getSavingsOverview(c: Context<AppEnv>): Promise<Response> {
  const [products, latestDay] = await Promise.all([
    new D1ProductSearchRepository(c.env.DB).searchByName(
      null,
      Number.MAX_SAFE_INTEGER,
    ),
    new D1SavingsSnapshotRepository(c.env.DB).findLatestDay(),
  ]);
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));

  const asOf: string | null = latestDay.length > 0 ? latestDay[0]!.asOf : null;

  // Group the sufficient-data rows by the stored category.
  const byCategory = new Map<
    string,
    (SavingsSnapshotRecord & { alkoReferenceCents: number; productName: string })[]
  >();
  for (const row of latestDay) {
    if (row.alkoReferenceCents === null) continue;
    const productName = nameByProductId.get(row.productId);
    if (productName === undefined) continue;
    const group = byCategory.get(row.category) ?? [];
    group.push({ ...row, alkoReferenceCents: row.alkoReferenceCents, productName });
    byCategory.set(row.category, group);
  }

  const categories = [...byCategory.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = {
    asOf,
    categories: categories.map((category) => {
      const rows = byCategory.get(category)!;
      const sum = rows.reduce((total, row) => total + row.bestPriceCents, 0);
      const largest = selectLargestDifference(rows)!;
      return {
        category,
        productCount: rows.length,
        averageObservedPriceCents: Math.round(sum / rows.length),
        largestDifference: {
          productId: largest.productId,
          productName: largest.productName,
          merchant: largest.bestMerchant,
          merchantCountry: largest.bestMerchantCountry,
          observedPriceCents: largest.bestPriceCents,
          referenceCents: largest.alkoReferenceCents,
          gapCents: largest.gapCents,
          gapBasisPoints: largest.gapBasisPoints,
        },
      };
    }),
  };

  return c.json(payload);
}

/**
 * Absent/blank/invalid limit values fall back to the route's default
 * (search-route parsePositiveInt parity — a malformed limit never 400s a
 * read); a present valid value is clamped to the route's max.
 */
function parseLimit(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(value, max);
}

/** The listing row — every figure carries its provenance fields. */
interface SavingsRowJson {
  readonly productId: number;
  readonly productName: string;
  readonly category: string;
  readonly merchant: string;
  readonly merchantCountry: string;
  readonly priceCents: number;
  readonly observedAt: string;
  readonly landedTotalCents: number;
  readonly alkoReferenceCents: number;
  readonly alkoObservedAt: string | null;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly reliability: string;
  readonly confidence: string;
  readonly taxDatasetVersion: string;
}

/** Materialize one listed row — every figure carries its provenance. */
function toSavingsRowJson(
  row: SavingsSnapshotRecord & { alkoReferenceCents: number },
  productName: string,
): SavingsRowJson {
  return {
    productId: row.productId,
    productName,
    category: row.category,
    merchant: row.bestMerchant,
    merchantCountry: row.bestMerchantCountry,
    priceCents: row.bestPriceCents,
    observedAt: row.bestObservedAt.toISOString(),
    landedTotalCents: row.landedTotalCents,
    alkoReferenceCents: row.alkoReferenceCents,
    alkoObservedAt:
      row.alkoObservedAt === null ? null : row.alkoObservedAt.toISOString(),
    gapCents: row.gapCents,
    gapBasisPoints: row.gapBasisPoints,
    reliability: row.landedReliability,
    confidence: row.confidence,
    taxDatasetVersion: row.taxDatasetVersion,
  };
}

async function getSavings(c: Context<AppEnv>): Promise<Response> {
  const category = (c.req.query('category') ?? '').trim();
  if (category.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'category query parameter is required (one product category)',
      error: 'ValidationError',
    });
  }
  const limit = parseLimit(c.req.query('limit'), DEFAULT_LIMIT, MAX_LIMIT);

  const [products, latestDay] = await Promise.all([
    new D1ProductSearchRepository(c.env.DB).searchByName(
      null,
      Number.MAX_SAFE_INTEGER,
    ),
    new D1SavingsSnapshotRepository(c.env.DB).findLatestDay(),
  ]);

  // The registry count and the name map come from the one read (see the
  // module docblock — the derivation decision).
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));

  // All findLatestDay rows share the maximal as_of (single-day read) —
  // the materialized day itself. Null while the pass has never written:
  // an honest empty state, not an error (spec: honest zero state).
  const asOf: string | null = latestDay.length > 0 ? latestDay[0]!.asOf : null;

  // The pass writes a row only with a computed gap against a reference,
  // so this filter is defense against corrupt rows, not a data path.
  // The predicate narrowing keeps the listed rows' reference non-null.
  const withReference = latestDay.filter(
    (row): row is SavingsSnapshotRecord & { alkoReferenceCents: number } =>
      row.alkoReferenceCents !== null,
  );

  const inCategory = withReference.filter((row) => row.category === category);
  const snapshotByProductId = new Map(
    inCategory.map((row) => [row.productId, row] as const),
  );

  // Rows whose product name the registry no longer resolves are stale —
  // omitted (module docblock), never rendered with a guessed name.
  const values: SavingsGapValue[] = [];
  for (const row of inCategory) {
    const productName = nameByProductId.get(row.productId);
    if (productName === undefined) continue;
    values.push({
      status: 'computed',
      productId: row.productId,
      productName,
      landedTotalCents: row.landedTotalCents,
      alkoReferenceCents: row.alkoReferenceCents,
      gapCents: row.gapCents,
      gapBasisPoints: row.gapBasisPoints,
    });
  }

  const listed = sortSavingsRows(values).slice(0, limit);
  const rows = listed.map((value) =>
    toSavingsRowJson(
      snapshotByProductId.get(value.productId)!,
      value.productName,
    ),
  );

  return c.json({
    asOf,
    category,
    coverage: {
      evaluated: products.length,
      withReference: withReference.length,
      listed: rows.length,
    },
    rows,
  });
}

/**
 * Cross-category top-N import-favourable listing (task 1.1, change
 * homepage-live-gap-hero; day fallback, change savings-top-day-fallback)
 * — GET /api/v1/savings/top.
 *
 * The homepage hero's read: the N rows with the largest gaps among
 * import-favourable rows — gapCents < 0, the landed total below the Alko
 * reference — from ONE snapshot day, across ALL categories, in the
 * core-domain deterministic order ({@link sortSavingsRows}). The
 * explicit negative-gap filter is the no-padding guarantee: a
 * dearer-than-reference row is never filled in, so fewer eligible rows
 * than N returns exactly those.
 *
 * ## Day selection — the 3-day fallback
 *
 * The endpoint reads the {@link TOP_LOOKBACK_DAYS} most recent distinct
 * as_of days and walks them newest first, selecting the first day that
 * holds at least one eligible row. The walk short-circuits: an eligible
 * maximal day answers without reading any earlier day. Rows are never
 * mixed across days — the response carries exactly the selected day's
 * rows, its as-of, and its coverage. When no day within the lookback
 * holds an eligible row the answer is the honest zero state: an empty
 * list, the maximal day's as-of (null before the first materialization),
 * and zero import-favourable coverage — never an error.
 *
 * ## Coverage counts — derivation decision
 *
 * - `evaluated` — the product registry count, sourced exactly as the
 *   listing sources it; the same one registry read also builds the name
 *   map the eligibility defenses require (one read, two uses).
 * - `importFavourable` — the eligible rows of the SELECTED day counted
 *   BEFORE the limit slice, eligibility being the listing's staleness
 *   defenses (a computed reference, a name the registry still resolves)
 *   AND the negative gap.
 * - `listed` — the rows returned.
 *
 * A snapshot day with no eligible rows answers 200 with an empty list
 * and the counts — never an error; a never-materialized snapshot answers
 * with a null as-of. The JSON key order is fixed by construction: the
 * same D1 state yields a byte-identical body on every request.
 * Read-only, behind the same per-route age gate and the SAVINGS limiter
 * as the listing.
 */
async function getSavingsTop(c: Context<AppEnv>): Promise<Response> {
  const limit = parseLimit(
    c.req.query('limit'),
    TOP_DEFAULT_LIMIT,
    TOP_MAX_LIMIT,
  );

  const snapshots = new D1SavingsSnapshotRepository(c.env.DB);
  const [products, recentDays] = await Promise.all([
    new D1ProductSearchRepository(c.env.DB).searchByName(
      null,
      Number.MAX_SAFE_INTEGER,
    ),
    snapshots.listRecentAsOfDays(TOP_LOOKBACK_DAYS),
  ]);

  // The registry count and the name map come from the one read (see the
  // derivation decision above).
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));

  // Eligible = the listing's staleness defenses AND the import-favourable
  // half of the gap sign. A row failing any predicate is excluded before
  // ordering and counting — never guessed into a position.
  const eligibleOn = (
    rows: SavingsSnapshotRecord[],
  ): (SavingsSnapshotRecord & {
    alkoReferenceCents: number;
    productName: string;
  })[] => {
    const eligible: (SavingsSnapshotRecord & {
      alkoReferenceCents: number;
      productName: string;
    })[] = [];
    for (const row of rows) {
      if (row.alkoReferenceCents === null) continue;
      if (row.gapCents >= 0) continue;
      const productName = nameByProductId.get(row.productId);
      if (productName === undefined) continue;
      eligible.push({
        ...row,
        alkoReferenceCents: row.alkoReferenceCents,
        productName,
      });
    }
    return eligible;
  };

  // Walk the lookback window newest first and take the first day with an
  // eligible row — the latest day short-circuits, an earlier one is the
  // fallback. Never a mix: the whole answer comes from this one day.
  let selectedDay: string | null = null;
  let eligible: (SavingsSnapshotRecord & {
    alkoReferenceCents: number;
    productName: string;
  })[] = [];
  for (const day of recentDays) {
    const dayEligible = eligibleOn(await snapshots.findDay(day));
    if (dayEligible.length > 0) {
      selectedDay = day;
      eligible = dayEligible;
      break;
    }
  }

  // No eligible day in the window: the honest zero state — the maximal
  // day's as-of (recentDays[0]; null while the pass has never written).
  const asOf: string | null =
    selectedDay ?? (recentDays.length > 0 ? recentDays[0]! : null);

  const eligibleByProductId = new Map(
    eligible.map((row) => [row.productId, row] as const),
  );
  const values: SavingsGapValue[] = eligible.map((row) => ({
    status: 'computed',
    productId: row.productId,
    productName: row.productName,
    landedTotalCents: row.landedTotalCents,
    alkoReferenceCents: row.alkoReferenceCents,
    gapCents: row.gapCents,
    gapBasisPoints: row.gapBasisPoints,
  }));

  // Most import-favourable gap first (the most negative bps), then the
  // listing's name/id tiebreaks; the slice is all the limit does — it
  // never pads.
  const listed = sortSavingsRows(values).slice(0, limit);
  const rows = listed.map((value) =>
    toSavingsRowJson(
      eligibleByProductId.get(value.productId)!,
      value.productName,
    ),
  );

  return c.json({
    asOf,
    coverage: {
      evaluated: products.length,
      importFavourable: eligible.length,
      listed: rows.length,
    },
    rows,
  });
}

/**
 * Best deal per cross-border merchant (task 1.3, change
 * savings-first-catalog-and-prefill) — GET
 * /api/v1/savings/best-per-merchant.
 *
 * Deterministic per-merchant listing over the same single-day snapshot
 * read as the listing and overview: exactly one row per cross-border
 * merchant — that merchant's row with the largest |gapCents|, ties
 * broken by productId ascending ({@link selectLargestDifference}; the
 * module docblock's derivation decision). Merchant `alko` never groups:
 * it is the reference side of every stored gap, not a deal provider.
 * The listing's staleness defenses apply unchanged — a row without a
 * computed reference or whose product name the registry no longer
 * resolves is omitted, never guessed; a merchant left without
 * qualifying rows disappears (an empty merchant entry is never
 * manufactured).
 *
 * Merchants sort by code-unit name ascending and the JSON key order is
 * fixed by construction: the same D1 state yields a byte-identical body
 * on every request. A never-materialized snapshot answers 200 with an
 * empty list and a null as-of — the honest zero state, never an error.
 * Read-only, behind the same per-route age gate and the SAVINGS limiter
 * as the listing.
 */
async function getSavingsBestPerMerchant(c: Context<AppEnv>): Promise<Response> {
  const [products, latestDay] = await Promise.all([
    new D1ProductSearchRepository(c.env.DB).searchByName(
      null,
      Number.MAX_SAFE_INTEGER,
    ),
    new D1SavingsSnapshotRepository(c.env.DB).findLatestDay(),
  ]);

  // The name map comes from the one registry read (same shape as the
  // overview — one read, one use here).
  const nameByProductId = new Map(products.map((p) => [p.id, p.name]));

  // All findLatestDay rows share the maximal as_of (single-day read) —
  // null while the pass has never written (honest zero state).
  const asOf: string | null = latestDay.length > 0 ? latestDay[0]!.asOf : null;

  // Group the sufficient-data rows by the best-offer merchant.
  const byMerchant = new Map<
    string,
    (SavingsSnapshotRecord & { alkoReferenceCents: number; productName: string })[]
  >();
  for (const row of latestDay) {
    if (row.bestMerchant === 'alko') continue;
    if (row.alkoReferenceCents === null) continue;
    const productName = nameByProductId.get(row.productId);
    if (productName === undefined) continue;
    const group = byMerchant.get(row.bestMerchant) ?? [];
    group.push({ ...row, alkoReferenceCents: row.alkoReferenceCents, productName });
    byMerchant.set(row.bestMerchant, group);
  }

  const merchants = [...byMerchant.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return c.json({
    asOf,
    merchants: merchants.map((merchant) => {
      const best = selectLargestDifference(byMerchant.get(merchant)!)!;
      return toSavingsRowJson(best, best.productName);
    }),
  });
}

/** Register the savings routes behind their gate and limiter. */
export function registerSavingsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/savings', ageGate());
  app.get('/api/v1/savings', requireRateLimit('SAVINGS'), getSavings);
  // Market overview (task 5.2) — read-only, same guard chain as the
  // listing: per-route age gate plus the SAVINGS limiter.
  app.on('GET', '/api/v1/savings/overview', ageGate());
  app.get(
    '/api/v1/savings/overview',
    requireRateLimit('SAVINGS'),
    getSavingsOverview,
  );
  // Cross-category top-N (task 1.1, homepage-live-gap-hero) — read-only,
  // same guard chain as the listing: per-route age gate plus the SAVINGS
  // limiter.
  app.on('GET', '/api/v1/savings/top', ageGate());
  app.get(
    '/api/v1/savings/top',
    requireRateLimit('SAVINGS'),
    getSavingsTop,
  );
  // Best deal per cross-border merchant (task 1.3,
  // savings-first-catalog-and-prefill) — read-only, same guard chain as
  // the listing: per-route age gate plus the SAVINGS limiter.
  app.on('GET', '/api/v1/savings/best-per-merchant', ageGate());
  app.get(
    '/api/v1/savings/best-per-merchant',
    requireRateLimit('SAVINGS'),
    getSavingsBestPerMerchant,
  );
  return app;
}

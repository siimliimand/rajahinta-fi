/**
 * Savings listing route (task 2.3, change insight-surfaces, spec
 * savings-discovery) — GET /api/v1/savings.
 *
 * Public, deterministic listing of the daily materialized snapshot rows
 * for ONE category, ordered by the core-domain sortSavingsRows rule
 * (gap basis points descending, product name ascending, product id as
 * the final tie). Guard chain (allowances parity): ageGate() per-route
 * plus the route-local SAVINGS limiter.
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
const DEFAULT_LIMIT = 50;
/** Hard cap — the listing is a discovery surface, not a bulk export. */
const MAX_LIMIT = 100;

/**
 * Largest observed cross-border difference within one category — the
 * objective euro delta |gapCents| (the sign carries the direction, the
 * absolute value the magnitude), with the fixed deterministic tie-break
 * of productId ascending. No editorial picks, no trending, no boost:
 * the same input always selects the same row.
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
 * Absent/blank/invalid limit values fall back to DEFAULT (search-route
 * parsePositiveInt parity — a malformed limit never 400s a read); a
 * present valid value is clamped to MAX.
 */
function parseLimit(raw: string | undefined): number {
  const fallback = DEFAULT_LIMIT;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(value, MAX_LIMIT);
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

async function getSavings(c: Context<AppEnv>): Promise<Response> {
  const category = (c.req.query('category') ?? '').trim();
  if (category.length === 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'category query parameter is required (one product category)',
      error: 'ValidationError',
    });
  }
  const limit = parseLimit(c.req.query('limit'));

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
  const rows: SavingsRowJson[] = listed.map((value) => {
    const row = snapshotByProductId.get(value.productId)!;
    return {
      productId: row.productId,
      productName: value.productName,
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
  });

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
  return app;
}

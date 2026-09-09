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

/** Register the savings listing behind its gate and limiter. */
export function registerSavingsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/savings', ageGate());
  app.get('/api/v1/savings', requireRateLimit('SAVINGS'), getSavings);
  return app;
}

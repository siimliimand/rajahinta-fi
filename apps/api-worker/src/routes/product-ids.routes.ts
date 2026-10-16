/**
 * Product-id enumeration route (task 1.1, change sitemap-tree-coverage).
 *
 * `GET /api/v1/products/ids` — the sitemap tree's data source: id-ordered
 * `offset`/`limit` slices of the catalog's listing universe with a
 * truthful per-product `lastmod`
 * (`MAX(product_master.updated_at, latest retail_offers.observed_at)`,
 * the `updated_at`-only degradation falling out naturally for offer-less
 * rows — design D5). The read lives in the data-platform repository
 * (`D1ProductSearchRepository.listProductIdSlice`); this file owns only
 * the HTTP contract:
 *
 * - `limit` clamps at {@link MAX_PRODUCT_ID_SLICE} (5,000, design D2 —
 *   chunk size never grows). The clamp is not an error: the sitemap
 *   generator asks for exactly the chunk size, and an over-ask serves the
 *   capped slice.
 * - `offset`/`limit` parse with the route family's tolerant semantics
 *   (search.routes parsePositiveInt precedent): absent/invalid falls back
 *   to the default, never a crash — the consumer always gets a well-formed
 *   slice.
 * - The literal `/ids` path is registered BEFORE `/api/v1/products/:id`
 *   (see index.ts registration order) so the id-parameter route can never
 *   capture it, under any router precedence rule.
 *
 * Guard composition mirrors the products listing exactly: the same Nest
 * SearchController class age gate (the frontend sitemap reader sends the
 * same x-age-confirmation token it already sends for catalog reads).
 *
 * Failure posture (design D4, lifted one level): a repository read
 * failure is an honest 500 envelope with the repository's message — never
 * a synthesized partial payload, because a dead reference in the sitemap
 * index is exactly the degradation contract forbids.
 *
 * @module ProductIdsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// Direct source import, route-file parity (search.routes header comment):
// wrangler aliases the package barrel, so route files deep-import.
import {
  D1ProductSearchRepository,
} from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';

/**
 * Slice cap (design D2, change sitemap-tree-coverage): 5,000 products per
 * chunk. Chunk COUNT grows with the catalog; chunk SIZE never does. The
 * same number is the default slice when `limit` is absent.
 */
const MAX_PRODUCT_ID_SLICE = 5_000;

/**
 * Non-negative integer query value; absent/blank/invalid falls back
 * (parsePositiveInt semantics, with 0 legal — an offset of zero IS the
 * first slice). A negative value falls back too: SQL would treat a
 * negative OFFSET as 0, but the contract is explicitness, not coercion.
 */
function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function listProductIds(c: Context<AppEnv>): Promise<Response> {
  const offset = parseNonNegativeInt(c.req.query('offset'), 0);
  // Over-ask clamps at the design-D2 chunk size — never an error.
  const limit = Math.min(
    parseNonNegativeInt(c.req.query('limit'), MAX_PRODUCT_ID_SLICE),
    MAX_PRODUCT_ID_SLICE,
  );
  try {
    const page = await new D1ProductSearchRepository(
      c.env.DB,
    ).listProductIdSlice(offset, limit);
    return c.json({ items: page.items, total: page.total });
  } catch (err) {
    // Honest failure: the repository's message rides the unified 500
    // envelope. No partial payload, no substituted lastmod — the sitemap
    // index must never reference data this read did not actually serve.
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Product id enumeration failed',
    );
  }
}

/** Register the id-enumeration handler (age gate registered per-route). */
export function registerProductIdsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // The products listing's exact guard (Nest SearchController class age
  // gate): server-to-server readers confirm age with the same token.
  app.on('GET', '/api/v1/products/ids', ageGate());
  // Handler after the guard, before /api/v1/products/:id in registration
  // order (index.ts) — the literal segment wins the match.
  app.get('/api/v1/products/ids', listProductIds);
  return app;
}

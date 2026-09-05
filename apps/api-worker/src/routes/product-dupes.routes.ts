/**
 * Product dupes route port (task 6.3, change product-roadmap-phases-1-4)
 * — GET /api/v1/products/:id/dupes, design R9, spec: producer-matching.
 *
 * Guard/rate-limit composition (route-scoped, historical/trip precedent):
 *   GET /api/v1/products/:id/dupes
 *     FeatureFlag(PRODUCER_DUPE_FINDER) → RateLimit(DEFAULT) → handler
 *
 * MATCHING ARCHITECTURE (binding, R9): the only lookup is the
 * repository's exact PUBLISHED-by-(product, normalized producer key)
 * query — the product's own `manufacturer` field supplies the key, and
 * the repository normalizes it (trim + lowercase + whitespace collapse)
 * before the plain-equality match. No similarity, scoring, embedding,
 * or fuzzy path exists in this module (spec "No similarity scoring" —
 * source-level isolation); a near-miss key matches nothing.
 *
 * Evidence discipline (R9): every returned link carries the COMPLETE
 * evidence — producer key, manufacturer, source URL, reviewer,
 * reviewed-at. The fields are NOT NULL at the schema level and nothing
 * here truncates or projects them away; the WHY travels with every
 * sibling.
 *
 * Result semantics: no curated links ⇒ 200 with an empty list — "no
 * dupes" is an answer, never a 404 (spec "No links"). An unknown
 * product id follows the product read route's 404 semantics
 * (`Product ${id} not found`, search.routes.ts parity).
 *
 * Rate-limit profile: DEFAULT — the public unauthenticated read profile
 * (60/min, the outbound-redirect precedent); this is a public read with
 * no domain profile of its own, unlike the historical-data neighbor
 * whose HISTORICAL profile names its domain.
 *
 * @module ProductDupesRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, requireFeatureFlag } from '../middleware/feature-flags';
import { requireRateLimit } from '../middleware/rate-limit';
import { parseIntParam } from './support';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1ProducerLinksRepository } from '../../../../packages/data-platform/src/repositories/d1/producer-links.repository';

/** One evidence-backed sibling — the complete R9 evidence set. */
interface ProductDupe {
  /** The foreign-shop sibling product the link evidences. */
  readonly siblingProductId: number;
  /** The normalized producer key the exact match ran on. */
  readonly producerKey: string;
  /** The manufacturer behind the link — the WHY. */
  readonly manufacturer: string;
  /** Verifiable source URL for the sibling claim. */
  readonly sourceUrl: string;
  /** Operator who reviewed the link. */
  readonly reviewer: string;
  /** ISO-8601 instant of the recorded review. */
  readonly reviewedAt: string;
}

interface ProductDupesResponse {
  readonly dupes: readonly ProductDupe[];
}

async function getProductDupes(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  try {
    const product = await new D1ProductSearchRepository(c.env.DB).findById(id);
    if (product === null) {
      // Existing product-route 404 semantics (search.routes.ts parity).
      throw new ApiHttpError(404, `Product ${id} not found`);
    }

    // The WHY is the producer: the product's own manufacturer is the
    // matching key. The repository normalizes it and matches by exact
    // equality against PUBLISHED rows only — nothing else qualifies.
    const links = await new D1ProducerLinksRepository(c.env.DB).findPublishedByAlkoProductAndKey(
      id,
      product.manufacturer,
    );

    const body: ProductDupesResponse = {
      dupes: links.map((link) => ({
        siblingProductId: link.siblingProductId,
        producerKey: link.producerKey,
        manufacturer: link.manufacturer,
        sourceUrl: link.sourceUrl,
        reviewer: link.reviewer,
        reviewedAt: link.reviewedAt.toISOString(),
      })),
    };
    return c.json(body);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to fetch product dupes',
    );
  }
}

/** Register the dupes handler behind its flag gate + limiter. */
export function registerProductDupesRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get(
    '/api/v1/products/:id/dupes',
    requireFeatureFlag(FeatureFlag.PRODUCER_DUPE_FINDER),
    requireRateLimit('DEFAULT'),
    getProductDupes,
  );
  return app;
}

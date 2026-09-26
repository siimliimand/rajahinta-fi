/**
 * Category benchmarks route (task 3.1, change
 * client-experience-improvement) — GET /api/v1/benchmarks/category-averages.
 *
 * Per canonical excise category, the current average price per litre of
 * the observed catalog offers, split into the domestic Alko average and
 * the cross-border webshop average; each figure carries its as-of date
 * and reliability status, and a category or segment without covering
 * data reports `null` — honest absence, never a substituted number
 * (spec price-benchmarks).
 *
 * DISPLAY-ONLY (proposal decision D1): the response is a read-model over
 * observed offers. It never enters a calculation total, a breakdown, or
 * any ranking input — pinned by tests/compliance/
 * benchmarks-display-only.test.ts (import analysis + calculation/ranking
 * byte-identity across zero, one, and many benchmark rows).
 *
 * Guard chain (savings.routes parity): per-route ageGate() plus the
 * SEARCH limiter — a public catalog-read; the profile set lives in
 * middleware/rate-limit.ts, which this change does not extend.
 *
 * @module BenchmarksRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';
import { requireRateLimit } from '../middleware/rate-limit';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../../../../packages/data-platform/src/d1/schema';
import {
  D1CategoryBenchmarkRepository,
  aggregateCategoryBenchmarks,
} from '../../../../packages/data-platform/src/repositories/d1/category-benchmarks.repository';

/** Canonical-category membership — the one shared value set (design D2). */
function isCanonicalCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

async function getCategoryAverages(c: Context<AppEnv>): Promise<Response> {
  // Category validation against the shared canonical set: an unknown
  // value is a contract-level parameter error with the SAME shape as the
  // products route' unknown-category treatment (search.routes parity).
  // Blank counts as absent (all categories), matching the q/ids/category
  // blankness handling. Raised outside the try below so the parameter
  // error renders as its own 400, never a wrapped 500.
  const category = c.req.query('category');
  const categoryParam =
    category !== undefined && category.trim().length > 0
      ? category
      : undefined;
  if (categoryParam !== undefined && !isCanonicalCategory(categoryParam)) {
    throw new ApiHttpError(
      400,
      `Unknown category '${categoryParam}'. Valid categories: ${PRODUCT_CATEGORIES.join(', ')}.`,
    );
  }

  try {
    const rows = await new D1CategoryBenchmarkRepository(
      c.env.DB,
    ).categoryOfferRows(categoryParam);
    // Key order is fixed by construction over the canonical category
    // order — the same D1 state yields a byte-identical body on every
    // request (savings-overview determinism precedent).
    const categories = aggregateCategoryBenchmarks(
      rows,
      categoryParam !== undefined ? [categoryParam] : PRODUCT_CATEGORIES,
    );
    return c.json({ categories });
  } catch (err) {
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Category benchmarks failed',
    );
  }
}

/** Register the benchmarks route behind its gate and limiter. */
export function registerBenchmarksRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.on('GET', '/api/v1/benchmarks/category-averages', ageGate());
  app.get(
    '/api/v1/benchmarks/category-averages',
    requireRateLimit('SEARCH'),
    getCategoryAverages,
  );
  return app;
}

/**
 * Unit-price ranking route (trust-and-reach-roadmap task 7.1).
 *
 *   GET /api/v1/unitprice/ranking?category=<key>
 *
 * The per-category €/g listing (spec unit-price-metrics, MODIFIED
 * requirement "Category ranking by ethanol unit price"): products of one
 * canonical category ordered by €/g ascending, equal values resolved by
 * product id, every row carrying its reliability status, and products
 * with no computable unit price omitted. The metric itself comes from
 * the pure `eurPerGram` module and the order from the pure
 * `rankUnitPrices` policy — nothing is re-implemented here.
 *
 * Pure read endpoint: the ordering is a read-model listing only and
 * never feeds search order, default ordering, or any calculation input.
 *
 * Guard composition (product-surface parity — the ranking lists
 * alcoholic beverages, so the same confirmation precedes the handler):
 *   GET /api/v1/unitprice/ranking   RateLimit — none → AgeGate
 *
 * @module UnitPriceRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// Direct source imports, route-file parity (search.routes) — wrangler
// aliases the @rajahinta/core-domain barrel to the bridge module, which
// re-exports only the pipeline's runtime closure.
import { eurPerGram } from '../../../../packages/core-domain/src/unitprice/eur-per-gram';
import {
  rankUnitPrices,
  type UnitPriceRankingEntry,
} from '../../../../packages/core-domain/src/unitprice/ranking';
import type { ReliabilityStatus } from '../../../../packages/core-domain/src/reliability/reliability.types';
import { TAX_CATEGORY_KEYS } from '../../../../packages/core-domain/src/tax/tax-categories';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

/**
 * Upper bound on the products examined per ranking request — the
 * repository's documented fetch-then-shape scale (design D3, ~10⁴
 * product rows). The category filter is applied app-side over the same
 * listing the search surface reads; Phase 1 adds no new SQL surface.
 */
const RANKING_MAX_PRODUCTS = 10_000;

const CATEGORY_KEYS: readonly string[] = TAX_CATEGORY_KEYS;
const VALID_CATEGORIES_MESSAGE = `Valid categories: ${CATEGORY_KEYS.join(', ')}.`;

// ---------------------------------------------------------------------------
// Local parsing helpers — parity with search.routes.ts (route files are
// self-contained; the same stored formats are read here).
// ---------------------------------------------------------------------------

/** Product row projection used by the ranking mapping. */
interface ProductRow {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: string | null;
  readonly unitVolume: string;
}

/**
 * `unit_volume` is the numeric(10,4) column rendered as fixed-scale text
 * ("0.33") — already litres. The column is NOT NULL, so an unparseable
 * value is corrupt data, not a missing one: NaN propagates into the
 * metric and is reported as INVALID_VOLUME. A value is never invented.
 */
function parseLitres(raw: string): number {
  return Number.parseFloat(raw);
}

/** ABV numeric(5,3) text ("0.047") → fraction, or null when absent. */
function parseAlcoholFraction(raw: string | null): number | null {
  return raw !== null ? Number.parseFloat(raw) : null;
}

const RELIABILITY_STATUSES: readonly string[] = [
  'VERIFIED',
  'STALE',
  'ESTIMATED',
  'UNAVAILABLE',
];

/**
 * Narrow the offer's stored reliability status (a loose string at the
 * repository boundary) to the domain union. An unknown stored value is
 * treated as UNAVAILABLE — the price provenance is unreadable, so the
 * metric must not present it as VERIFIED.
 */
function toReliabilityStatus(raw: string): ReliabilityStatus {
  return RELIABILITY_STATUSES.includes(raw)
    ? (raw as ReliabilityStatus)
    : 'UNAVAILABLE';
}

/** The physical inputs the €/g metric derives from, parsed once per product. */
interface UnitPriceInputs {
  readonly unitVolumeL: number;
  readonly alcoholFraction: number | null;
}

function unitPriceInputs(p: ProductRow): UnitPriceInputs {
  return {
    unitVolumeL: parseLitres(p.unitVolume),
    alcoholFraction: parseAlcoholFraction(p.alcoholByVolume),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * The `category` query parameter is required and must be a canonical
 * key — the same closed set the traveller-allowance and tax categories
 * use (TAX_CATEGORY_KEYS), so a ranking request can never silently
 * filter against a key no product row carries.
 */
function parseCategoryParam(c: Context<AppEnv>): string {
  const raw = c.req.query('category');
  const category = raw?.trim() ?? '';
  if (category.length === 0) {
    throw new ApiHttpError(
      400,
      `Query parameter 'category' is required. ${VALID_CATEGORIES_MESSAGE}`,
    );
  }
  if (!CATEGORY_KEYS.includes(category)) {
    throw new ApiHttpError(
      400,
      `Unknown category '${category}'. ${VALID_CATEGORIES_MESSAGE}`,
    );
  }
  return category;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** One ranking row — the minimal per-product facts the value page renders. */
interface RankingRow {
  readonly productId: number;
  readonly name: string;
  readonly brand: string;
  /** The offer the ranked value was derived from (provenance). */
  readonly offerId: number;
  readonly centsPerGram: number;
  readonly ethanolGrams: number;
  readonly reliabilityStatus: 'VERIFIED' | 'ESTIMATED';
}

async function ranking(c: Context<AppEnv>): Promise<Response> {
  const category = parseCategoryParam(c);

  try {
    const repo = new D1ProductSearchRepository(c.env.DB);
    const products = await repo.searchByName(null, RANKING_MAX_PRODUCTS);
    const productById = new Map(products.map((p) => [p.id, p]));

    // One candidate per offer of every product in the category. Reads are
    // sequential and bounded: output order never depends on read order
    // (the pure ranking policy decides it), and the sweep must not fan
    // out unbounded against D1.
    const entries: UnitPriceRankingEntry[] = [];
    for (const product of products) {
      if (product.category !== category) continue;
      const inputs = unitPriceInputs(product);
      const offers = await repo.findOffers(product.id);
      for (const offer of offers) {
        entries.push({
          productId: product.id,
          offerId: offer.id,
          metric: eurPerGram(
            offer.priceCents,
            inputs.unitVolumeL,
            inputs.alcoholFraction,
            toReliabilityStatus(offer.reliabilityStatus),
          ),
        });
      }
    }

    // Omission, best-offer selection, and the total €/g/id order all
    // live in the pure policy — this handler only joins the identity
    // fields back onto the ranked rows.
    const items: RankingRow[] = rankUnitPrices(entries).map((row) => {
      const product = productById.get(row.productId);
      if (product === undefined) {
        // Unreachable — every ranked id comes from the listing just read.
        // Fail loudly rather than substitute an anonymous row.
        throw new Error(
          `Ranked product ${row.productId} missing from the category listing`,
        );
      }
      return {
        productId: row.productId,
        name: product.name,
        brand: product.brand,
        offerId: row.offerId,
        centsPerGram: row.centsPerGram,
        ethanolGrams: row.ethanolGrams,
        reliabilityStatus: row.reliabilityStatus,
      };
    });

    return c.json({ category, items });
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Unit-price ranking failed',
    );
  }
}

/** Register the ranking handler (guard registered per-route here). */
export function registerUnitPriceRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Age-gate parity with the product surface: the ranking lists alcoholic
  // beverages by category, so the same confirmation precedes the handler.
  app.on('GET', '/api/v1/unitprice/ranking', ageGate());
  app.get('/api/v1/unitprice/ranking', ranking);
  return app;
}

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
 * Pack products price the package (task 6.2, change
 * honest-trust-surfaces): the pack size parses from the product NAME at
 * read time — the same derivation the search embeds use — so a 24-pack
 * row ranks on its package total, never single-unit math.
 *
 * Acquisition is one repository call (task 1.1, change
 * unitprice-ranking-scale-fix): `listCategoryOfferCandidates(category)`
 * returns the category's products with their current offers already
 * joined inline, so the retired fetch-then-sweep — every product listed,
 * then one `findOffers` round trip per product — cannot return: that
 * O(category) D1 fan-out blew the edge time budget on large categories
 * (the 2026-10 wine_still ≈ 100 s timeout incident). The route suite
 * pins the bound (≤ 2 D1 statements per request, design D5) so a
 * per-product sweep fails CI rather than production.
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
import { parsePackUnits } from '../../../../packages/data-acquisition/src/services/pack-notation';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { ageGate } from '../middleware/age-gate';
import {
  D1ProductSearchRepository,
  type CategoryOfferCandidate,
} from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

const CATEGORY_KEYS: readonly string[] = TAX_CATEGORY_KEYS;
const VALID_CATEGORIES_MESSAGE = `Valid categories: ${CATEGORY_KEYS.join(', ')}.`;

// ---------------------------------------------------------------------------
// Local parsing helpers — parity with search.routes.ts (route files are
// self-contained; the same stored formats are read here).
// ---------------------------------------------------------------------------

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

/**
 * The physical inputs the €/g metric derives from, parsed once per
 * candidate row. `unitsPerPackage` is the pack SIZE parsed from the
 * product NAME at read time (task 6.2 amendment) — a multipack's price
 * is a package price, so the metric divides it by the package total
 * volume. `undefined` = the name states no decisive count (single-unit
 * default 1); the value is never persisted, and the ranking parses the
 * SAME name through the SAME parser the search embeds use.
 */
interface UnitPriceInputs {
  readonly unitVolumeL: number;
  readonly alcoholFraction: number | null;
  readonly unitsPerPackage: number | undefined;
}

function unitPriceInputs(candidate: CategoryOfferCandidate): UnitPriceInputs {
  return {
    unitVolumeL: parseLitres(candidate.unitVolume),
    alcoholFraction: parseAlcoholFraction(candidate.alcoholByVolume),
    unitsPerPackage: parsePackUnits(candidate.name) ?? undefined,
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
    // The whole category's candidates in one round trip (task 1.1):
    // latest-per-(product, merchant) offers joined inline. A product
    // without offers has no candidate row — the same omission the
    // retired per-product sweep produced.
    const candidates = await repo.listCategoryOfferCandidates(category);

    const entries: UnitPriceRankingEntry[] = candidates.map((candidate) => {
      const inputs = unitPriceInputs(candidate);
      return {
        productId: candidate.productId,
        offerId: candidate.offerId,
        // Pack rows pass the name-parsed units so the denominator is
        // the package total — the ranking cannot price a 24-pack
        // against one can.
        metric: eurPerGram(
          candidate.priceCents,
          inputs.unitVolumeL,
          inputs.alcoholFraction,
          toReliabilityStatus(candidate.reliabilityStatus),
          inputs.unitsPerPackage,
        ),
      };
    });

    // A multi-merchant product yields one candidate row per merchant;
    // name/brand come from the joined product row and are identical
    // across those rows, so any row per id carries the identity fields.
    const candidateById = new Map(
      candidates.map((candidate) => [candidate.productId, candidate]),
    );

    // Omission, best-offer selection, and the total €/g/id order all
    // live in the pure policy — this handler only joins the identity
    // fields back onto the ranked rows.
    const items: RankingRow[] = rankUnitPrices(entries).map((row) => {
      const candidate = candidateById.get(row.productId);
      if (candidate === undefined) {
        // Unreachable — every ranked id comes from the candidates just
        // read. Fail loudly rather than substitute an anonymous row.
        throw new Error(
          `Ranked product ${row.productId} missing from the category candidates`,
        );
      }
      return {
        productId: row.productId,
        name: candidate.name,
        brand: candidate.brand,
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

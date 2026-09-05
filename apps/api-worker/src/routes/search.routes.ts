/**
 * Search route port (task 3.5) — Hono re-host of SearchController
 * (packages/application-api/src/search/).
 *
 * Guard composition (Nest class guards, scoped to the controller's two
 * routes so the historical controller sharing the /api/v1/products prefix
 * carries ONLY its own guard set — Nest applies class guards per
 * controller, not per URL prefix):
 *   GET /api/v1/products        RateLimit — none in Nest → LaunchGate(PRICE_DATA) → AgeGate
 *   GET /api/v1/products/:id    same
 *
 * Reads go through the D1 product-search repository (FTS5 + LIKE
 * fallback, task 2.2); the alphabetical sort and pagination semantics are
 * copied verbatim. The detail response embeds per-merchant reliability
 * scores only while ADVANCED_FEATURES is enabled (informational only —
 * see src/services/merchant-reliability.ts). While
 * UNIT_PRICE_EUR_PER_GRAM is on, search items and detail offers carry the
 * read-time €/g metric (`eurPerGram`) with its status; flag off leaves
 * the key absent (byte-compatible payloads, never persisted).
 *
 * @module SearchRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
// Direct source imports, route-file parity (basket/calculator.routes) —
// wrangler aliases the @rajahinta/core-domain barrel to the bridge module,
// which re-exports only the pipeline's runtime closure.
import { eurPerGram } from '../../../../packages/core-domain/src/unitprice/eur-per-gram';
import type { UnitPriceResult } from '../../../../packages/core-domain/src/unitprice/unitprice.types';
import type { ReliabilityStatus } from '../../../../packages/core-domain/src/reliability/reliability.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { FeatureFlag, FeatureFlagService } from '../middleware/feature-flags';
import { ageGate } from '../middleware/age-gate';
import { requireLaunchGate } from '../middleware/launch-gate';
import {
  getMerchantReliabilityMap,
  type MerchantReliabilityMap,
} from '../services/merchant-reliability';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

/** Default page size for product listing (controller parity). */
const DEFAULT_PAGE_SIZE = 20;
/** Maximum page size to prevent abuse. */
const MAX_PAGE_SIZE = 100;

/** Alphabetical comparison by Finnish-collated name (controller parity). */
function compareByName(
  a: { name: string },
  b: { name: string },
): number {
  return a.name.localeCompare(b.name, 'fi');
}

/** Name ordering with the product-id tiebreaker (deterministic queries). */
function compareByNameThenId(
  a: { name: string; id: number },
  b: { name: string; id: number },
): number {
  return compareByName(a, b) || a.id - b.id;
}

/** Product row projection used by the search item mapping. */
interface ProductRow {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: string | null;
  readonly unitVolume: string;
  readonly containerType: string;
}

/** A search-result item — ProductSearchItem shape with sortable keys. */
type SearchItem = {
  id: number;
  name: string;
  brand: string;
  category: string;
  alcoholByVolume: number | null;
  unitVolume: string;
  containerType: string;
  lowestPriceCents: number | null;
  merchantCount: number;
};

/**
 * Search item as returned: the flag-less shape, plus the €/g metric embed
 * only while `UNIT_PRICE_EUR_PER_GRAM` is on (key absent otherwise —
 * byte-compatible with the flag-less shape).
 */
type SearchItemResponse = SearchItem & { eurPerGram?: UnitPriceResult };

/** Map a product row to a search-result item (toSearchItem parity). */
function toSearchItem(p: ProductRow): SearchItem {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    alcoholByVolume:
      p.alcoholByVolume !== null ? parseFloat(p.alcoholByVolume) : null,
    unitVolume: p.unitVolume,
    containerType: p.containerType,
    lowestPriceCents: null,
    merchantCount: 0,
  };
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

/**
 * The €/g metric embed for a search item. The Phase 1 search path loads
 * no offers (lowestPriceCents is null), so there is no price to derive
 * from: the price input is NaN and the module reports the metric
 * unavailable — naming the first missing physical input (volume before
 * alcohol fraction, module precedence) so the item still says WHY it has
 * no €/g. The union has no MISSING_PRICE reason, so a product with
 * complete physical data degrades to INVALID_PRICE (the price input is
 * genuinely unusable here). No value is silently substituted (spec
 * unit-price-metrics).
 */
function searchItemUnitPrice(inputs: UnitPriceInputs): UnitPriceResult {
  return eurPerGram(Number.NaN, inputs.unitVolumeL, inputs.alcoholFraction);
}

/** Map a product row to its response shape, embedding the metric on flag. */
function toSearchItemResponse(
  p: ProductRow,
  includeUnitPrice: boolean,
): SearchItemResponse {
  const item = toSearchItem(p);
  if (!includeUnitPrice) return item;
  return {
    ...item,
    eurPerGram: searchItemUnitPrice(unitPriceInputs(p)),
  };
}

/** parsePositiveInt parity — invalid/absent values fall back. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function search(c: Context<AppEnv>): Promise<Response> {
  const ids = c.req.query('ids');
  const q = c.req.query('q');
  const sort = c.req.query('sort');
  const page = c.req.query('page');
  const limit = c.req.query('limit');

  const pageNum = parsePositiveInt(page, 1);
  const limitNum = Math.min(parsePositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const sortBy = sort ?? 'ALPHABETICAL';

  if (sortBy !== 'ALPHABETICAL') {
    throw new ApiHttpError(
      400,
      `Sort order '${sortBy}' is not supported in Phase 1. Only ALPHABETICAL is available.`,
    );
  }

  try {
    const repo = new D1ProductSearchRepository(c.env.DB);
    // Flag resolved in the route (per-request pattern, see getProduct):
    // on → each item carries the eurPerGram embed; off → the key stays
    // absent (byte-compatible with the flag-less shape).
    const includeUnitPrice = new FeatureFlagService(c.env).isEnabled(
      FeatureFlag.UNIT_PRICE_EUR_PER_GRAM,
    );
    let items: SearchItemResponse[] = [];
    const query = q !== undefined ? q.trim() : '';

    if (ids !== undefined && ids.trim().length > 0) {
      // ID lookup takes precedence over free-text search (q ignored).
      const productIds = ids
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n) && n > 0);

      const products = await Promise.all(productIds.map((id) => repo.findById(id)));
      items = products
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => toSearchItemResponse(p, includeUnitPrice));
      items.sort(compareByName);
    } else if (query.length > 0) {
      // Ranked search — the repository ranks (relevance order); an
      // explicit sort is honored over the filtered set.
      const products = await repo.searchRanked(query, MAX_PAGE_SIZE);
      items = products.map((p) => toSearchItemResponse(p, includeUnitPrice));
      if (sort !== undefined) {
        items.sort(compareByNameThenId);
      }
    } else {
      // Blank or absent q — the repository lists products alphabetically.
      const products = await repo.searchByName(q ?? null, MAX_PAGE_SIZE);
      items = products.map((p) => toSearchItemResponse(p, includeUnitPrice));
      items.sort(compareByName);
    }

    const start = (pageNum - 1) * limitNum;
    const paginated = items.slice(start, start + limitNum);

    return c.json({
      items: paginated,
      total: items.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(items.length / limitNum),
    });
  } catch (err) {
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Product search failed',
    );
  }
}

async function getProduct(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  try {
    const repo = new D1ProductSearchRepository(c.env.DB);
    const product = await repo.findById(id);
    if (product === null) {
      throw new ApiHttpError(404, `Product ${id} not found`);
    }

    const offers = await repo.findOffers(id);

    // Flag resolved in the route (established per-request pattern): on →
    // each offer carries the eurPerGram embed; off → the key stays absent
    // (byte-compatible with the flag-less shape). The embed never reorders
    // the offers — it maps in place.
    const includeUnitPrice = new FeatureFlagService(c.env).isEnabled(
      FeatureFlag.UNIT_PRICE_EUR_PER_GRAM,
    );
    // Physical inputs are per-product: parsed once and shared by every
    // offer's metric. unitVolume is litres as numeric text; an unparseable
    // value propagates as NaN → the module reports INVALID_VOLUME. The
    // ABV text is a fraction (0.047 = 4.7 %); absent → null → the module
    // reports MISSING_ALCOHOL_FRACTION.
    const inputs = unitPriceInputs(product);

    const response: Record<string, unknown> = {
      product: {
        id: product.id,
        name: product.name,
        manufacturer: product.manufacturer,
        brand: product.brand,
        category: product.category,
        alcoholByVolume:
          product.alcoholByVolume !== null
            ? parseFloat(product.alcoholByVolume)
            : null,
        unitVolume: product.unitVolume,
        containerType: product.containerType,
        regulatoryClassification: product.regulatoryClassification,
        depositSystemStatus: product.depositSystemStatus ?? false,
        ean: product.ean,
      },
      offers: offers.map((o) => ({
        id: o.id,
        merchant: o.merchant,
        country: o.country,
        priceCents: o.priceCents,
        currency: o.currency,
        availability: o.availability,
        sourceUrl: o.sourceUrl,
        observedAt:
          o.observedAt instanceof Date ? o.observedAt.toISOString() : String(o.observedAt),
        reliabilityStatus: o.reliabilityStatus,
        // Flag-gated embed: value offers inherit the offer price's
        // reliability (VERIFIED → computed, otherwise ESTIMATED);
        // missing/invalid inputs degrade to an explicit unavailable —
        // never a substituted value (spec unit-price-metrics).
        ...(includeUnitPrice
          ? {
              eurPerGram: eurPerGram(
                o.priceCents,
                inputs.unitVolumeL,
                inputs.alcoholFraction,
                toReliabilityStatus(o.reliabilityStatus),
              ),
            }
          : {}),
      })),
    };

    // Informational per-merchant scores — only while the flag is on; flag
    // off leaves the field absent (byte-compatible with the flag-less
    // shape). The embed never reorders the offers.
    const offersList = response.offers as Array<{ merchant: string }>;
    if (
      offersList.length > 0 &&
      new FeatureFlagService(c.env).isEnabled(FeatureFlag.ADVANCED_FEATURES)
    ) {
      const merchants = new Set(offersList.map((o) => o.merchant));
      const embed = await getMerchantReliabilityMap(c.env.DB, merchants);
      if (embed !== undefined) {
        return c.json({ ...response, merchantReliability: embed });
      }
    }

    return c.json(response);
  } catch (err) {
    if (err instanceof ApiHttpError) throw err;
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Failed to fetch product detail',
    );
  }
}

/** Register the search handlers (guards registered per-route here). */
export function registerSearchRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Nest SearchController class guards, method-scoped so the historical
  // controller's route (same prefix) keeps only its own guard set.
  for (const path of ['/api/v1/products', '/api/v1/products/:id']) {
    app.on('GET', path, requireLaunchGate('PRICE_DATA'), ageGate());
  }

  app.get('/api/v1/products', search);
  app.get('/api/v1/products/:id', getProduct);
  return app;
}

export type { MerchantReliabilityMap };

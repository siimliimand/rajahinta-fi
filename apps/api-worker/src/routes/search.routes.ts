/**
 * Search route port (task 3.5) — Hono re-host of SearchController
 * (packages/application-api/src/search/).
 *
 * Guard composition (Nest class guards, scoped to the controller's two
 * routes so the historical controller sharing the /api/v1/products prefix
 * carries ONLY its own guard set — Nest applies class guards per
 * controller, not per URL prefix):
 *   GET /api/v1/products        RateLimit — none in Nest → AgeGate
 *   GET /api/v1/products/:id    same
 *
 * Reads go through the D1 product-search repository (FTS5 + LIKE
 * fallback, task 2.2); the alphabetical sort and pagination semantics are
 * copied verbatim, extended by the objective server-side sort orders
 * (task 1.2, change client-experience-improvement: LOWEST_PRICE,
 * ALPHABETICAL, ALCOHOL_PERCENTAGE — unknown values 400 like unknown
 * categories; task 4.1, change catalog-first-run-polish flips the
 * absent-sort default to ALPHABETICAL across the browse, ranked-q, and
 * ids paths, superseding the first-impression-pass LOWEST_PRICE flip —
 * LOWEST_PRICE stays an explicit option). The detail response embeds
 * per-merchant reliability
 * scores (informational only — see src/services/merchant-reliability.ts).
 * Search items and detail offers carry the read-time €/g metric
 * (`eurPerGram`) with its status; on listings the metric derives from
 * the cheapest current-available single offer's price and provenance
 * (design D1, change honest-trust-surfaces) — the aggregate resolves
 * that offer's reliability, and the item reports MISSING_PRICE when
 * there is no current offer at all. Pack products divide by the
 * package total volume: the pack units parse from the product name at
 * read time (task 6.1 amendment) through the same parser on both the
 * listing and detail embed paths, so a pack row can never price a
 * 24-pack against one can.
 *
 * Detail offers carry the additive registry display name `merchantName`
 * (fi-locale-surface-hardening 2.5, design D3): resolved from
 * merchant_registry by the offer's `merchant` id, falling back to the
 * raw id. The identifier stays the wire contract and the
 * redirect/analytics key; the registry is never read on the listing
 * paths.
 *
 * Zero-result did-you-mean (task 3.2, change
 * finnish-first-client-experience): a ranked-q search that found nothing
 * carries the repository's advisory `suggestion` as an additive optional
 * top-level field — present only when a candidate exists; every existing
 * field, the ordering, and the customer's original query text are
 * untouched (design Q5 trust posture; task 3.3 renders the chip).
 *
 * Display-only savings embed (task 1.1, change
 * savings-first-catalog-and-prefill): every listed item with a
 * latest-materialized-day snapshot row carries a `savings` embed, and the
 * response states `savingsAsOf`. The join is composed in THIS route file
 * from D1SavingsSnapshotRepository.findLatestDay() (one read, map lookup
 * for the page's rows) — the product-search repository imports no savings
 * module, and no calculation, ranking, or optimization input changes.
 *
 * Default order BIGGEST_SAVING (task 1.2, same change): the absent sort
 * resolves to the savings-first order — covered rows (a latest-day
 * snapshot row exists) by gap basis points ascending (gap = landed −
 * reference, so the most negative gap is the biggest relative saving; a
 * positive gap is dearer than Alko and sorts after the savers, still
 * covered), with the FI-collated product name then the product id as the
 * deterministic ties; uncovered rows come after every covered row,
 * alphabetical with the same ties. The order composes at THIS route level
 * over the SAME one-read latest-day map the embeds use (design D3, one
 * read two uses): the browse path fetches the full matched key list
 * (listCatalogKeys — the repository's own sort orders stay untouched),
 * sorts it with the map, and slices the page itself, so every page cuts
 * the same total order; the ids and ranked-q paths sort their fetched set
 * with the same comparator. Explicit ALPHABETICAL / LOWEST_PRICE /
 * ALCOHOL_PERCENTAGE are unchanged; an unknown value stays a 400.
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
import { parsePackUnits } from '../../../../packages/data-acquisition/src/services/pack-notation';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { ageGate } from '../middleware/age-gate';
import {
  getMerchantReliabilityMap,
  type MerchantReliabilityMap,
} from '../services/merchant-reliability';
import {
  getMerchantWarnings,
  merchantsForProducts,
} from '../services/merchant-warnings';
import {
  CATALOG_SORT_ORDERS,
  CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL,
  D1ProductSearchRepository,
  type CatalogProductListItem,
  type CatalogProductListPage,
  type CatalogSortOrder,
} from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
// Display-surface composition (design D1, change
// savings-first-catalog-and-prefill): the savings snapshot repository is
// imported HERE, in the route file — never in the product-search
// repository, which must stay free of savings imports (isolation
// compliance, tests/compliance/savings-snapshot-isolation.test.ts).
import { D1SavingsSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotRecord } from '../../../../packages/data-platform/src/abstracts';
// Deep source import (route-file parity — see the header comment): the
// canonical category set is defined ONCE in the D1 schema module (design
// D2, change product-catalog), so route validation and the column CHECK
// cannot drift.
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../../../../packages/data-platform/src/d1/schema';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import { lowestCurrentOfferPriceCents } from './current-best-price';

/** Default page size for product listing (controller parity). */
const DEFAULT_PAGE_SIZE = 20;
/** Maximum page size to prevent abuse. */
const MAX_PAGE_SIZE = 100;

/**
 * Registry display names for the response's merchant ids
 * (fi-locale-surface-hardening 2.5, design D3) — one list read (the
 * registry is operator-scale, far smaller than the offer set), keyed by
 * merchant id. Fail-open: a registry failure returns an empty map and
 * every caller falls back to the raw id, so the rows stay renderable.
 * Detail/basket/history read paths only — never the catalog listing.
 */
async function merchantDisplayNames(
  d1: D1Database,
  merchants: readonly string[],
): Promise<Map<string, string>> {
  if (merchants.length === 0) return new Map();
  try {
    const rows = await new D1MerchantRegistryRepository(d1).list();
    return new Map(rows.map((row) => [row.merchantId, row.name]));
  } catch {
    return new Map();
  }
}

/** Canonical-category membership — the one shared value set (design D2). */
function isCanonicalCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * `sort` parameter (task 1.2, change client-experience-improvement) —
 * parsed against the repository's shared order set. Blank counts as
 * absent, and absent defaults to BIGGEST_SAVING (task 1.2, change
 * savings-first-catalog-and-prefill — the savings-first order, design D2;
 * supersedes catalog-first-run-polish's ALPHABETICAL default, which
 * survives only as an explicit option, as does the first-impression-pass
 * LOWEST_PRICE), matching the q/ids/category blankness handling; an
 * unknown value stays a contract-level parameter error — a 400 with the
 * same shape as the unknown-category treatment, never a silent fallback
 * (client-experience-improvement decision D3).
 */
function parseSortOrder(raw: string | undefined): CatalogSortOrder {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) return 'BIGGEST_SAVING';
  if ((CATALOG_SORT_ORDERS as readonly string[]).includes(trimmed)) {
    return trimmed as CatalogSortOrder;
  }
  throw new ApiHttpError(
    400,
    `Unknown sort '${trimmed}'. Valid sort orders: ${CATALOG_SORT_ORDERS.join(', ')}.`,
  );
}

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

/**
 * Lowest-price ordering (task 1.2): ascending by the lowest observed
 * offer price, products without offers last (honest absence is not a
 * price), product id as the deterministic tie.
 */
function compareByLowestPriceThenId(a: SearchItem, b: SearchItem): number {
  if (a.lowestPriceCents === null || b.lowestPriceCents === null) {
    if (a.lowestPriceCents === b.lowestPriceCents) return a.id - b.id;
    return a.lowestPriceCents === null ? 1 : -1;
  }
  return a.lowestPriceCents - b.lowestPriceCents || a.id - b.id;
}

/**
 * ABV ordering (task 1.2): descending alcohol by volume, products with
 * unknown ABV last, product id as the deterministic tie.
 */
function compareByAlcoholDescThenId(a: SearchItem, b: SearchItem): number {
  if (a.alcoholByVolume === null || b.alcoholByVolume === null) {
    if (a.alcoholByVolume === b.alcoholByVolume) return a.id - b.id;
    return a.alcoholByVolume === null ? 1 : -1;
  }
  return b.alcoholByVolume - a.alcoholByVolume || a.id - b.id;
}

/**
 * Savings-first ordering (task 1.2, change
 * savings-first-catalog-and-prefill, design D2) — the savings listing's
 * `sortSavingsRows` rule (gap basis points ascending: the most negative
 * gap is the biggest relative saving) extended with the catalog's
 * alphabetical tie-break, so the order is total and deterministic per
 * (data, day):
 *
 * - covered rows — a latest-day snapshot row exists — by gap basis
 *   points ascending; a POSITIVE gap (dearer than the Alko reference) is
 *   still covered and sorts after the savers, stating the fact plainly;
 * - ties break by FI-collated name, then product id (two distinct
 *   products can share a name and a gap);
 * - uncovered rows come after EVERY covered row — honest absence is
 *   last, never interpolated into the gap order — alphabetical with the
 *   same ties. With no materialized day at all every row is uncovered
 *   and the order degrades to the plain alphabetical contract.
 *
 * Generic over the row shape: the browse path sorts `(id, name)` keys
 * BEFORE hydrating the page, the ids/ranked-q paths sort full items.
 * Pure — reads the snapshot map, mutates nothing.
 */
function compareByBiggestSavingThenId<T extends { id: number; name: string }>(
  snapshotByProductId: ReadonlyMap<number, SavingsSnapshotRecord>,
): (a: T, b: T) => number {
  return (a, b) => {
    const aRow = snapshotByProductId.get(a.id);
    const bRow = snapshotByProductId.get(b.id);
    if (aRow === undefined || bRow === undefined) {
      // Same tier only when BOTH are uncovered (alphabetical); a mixed
      // pair always puts the covered row first.
      if (aRow === undefined && bRow === undefined) {
        return compareByNameThenId(a, b);
      }
      return aRow === undefined ? 1 : -1;
    }
    return (
      aRow.gapBasisPoints - bRow.gapBasisPoints || compareByNameThenId(a, b)
    );
  };
}

/**
 * The item comparator for an explicit sort over the ids/ranked-q paths
 * (task 1.2). These paths fetch product rows without the repository's
 * SQL key ordering, so the same objective order is applied app-side over
 * the fetched set. BIGGEST_SAVING composes over the request's latest-day
 * snapshot map (the same map the embeds use — never a second read).
 */
function compareBySortOrder(
  sortBy: CatalogSortOrder,
  snapshotByProductId: ReadonlyMap<number, SavingsSnapshotRecord>,
): (a: SearchItem, b: SearchItem) => number {
  if (sortBy === 'BIGGEST_SAVING') {
    return compareByBiggestSavingThenId(snapshotByProductId);
  }
  switch (sortBy) {
    case 'LOWEST_PRICE':
      return compareByLowestPriceThenId;
    case 'ALCOHOL_PERCENTAGE':
      return compareByAlcoholDescThenId;
    default:
      return compareByNameThenId;
  }
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
 * Search item as returned: the base shape plus the €/g metric embed.
 */
type SearchItemResponse = SearchItem & { eurPerGram: UnitPriceResult };

/**
 * Display-only savings embed (task 1.1, change
 * savings-first-catalog-and-prefill): one covered product's latest
 * materialized-day figures, mirrored verbatim from its snapshot row —
 * the same fields the /api/v1/savings rows carry. Display face only: it
 * never feeds a calculation, ranking input, or basket optimization
 * (isolation compliance), and `alkoReferenceCents` travels as stored
 * (null is corrupt-row defense, never substituted).
 */
interface SavingsEmbedJson {
  readonly landedTotalCents: number;
  readonly alkoReferenceCents: number | null;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly reliability: string;
  readonly confidence: string;
}

/** Mirror one snapshot row's display figures (SavingsRowJson parity). */
function toSavingsEmbed(row: SavingsSnapshotRecord): SavingsEmbedJson {
  return {
    landedTotalCents: row.landedTotalCents,
    alkoReferenceCents: row.alkoReferenceCents,
    gapCents: row.gapCents,
    gapBasisPoints: row.gapBasisPoints,
    reliability: row.landedReliability,
    confidence: row.confidence,
  };
}

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

/**
 * The physical inputs the €/g metric derives from, parsed once per product.
 * `unitsPerPackage` is the pack SIZE parsed from the product NAME at read
 * time (task 6.1 amendment) — a multipack's price is a package price, so
 * the metric divides it by the package total volume. `undefined` = the
 * name states no decisive count (single-unit default 1); the value is
 * never persisted, and both embed paths parse the SAME name through the
 * SAME parser, which is what keeps listing == detail on pack rows.
 */
interface UnitPriceInputs {
  readonly unitVolumeL: number;
  readonly alcoholFraction: number | null;
  readonly unitsPerPackage: number | undefined;
}

function unitPriceInputs(p: ProductRow): UnitPriceInputs {
  return {
    unitVolumeL: parseLitres(p.unitVolume),
    alcoholFraction: parseAlcoholFraction(p.alcoholByVolume),
    unitsPerPackage: parsePackUnits(p.name) ?? undefined,
  };
}

/**
 * The cheapest current offer's price with its narrowed provenance, or
 * null when the product has no current offer. The aggregate's
 * `min_price_cents` IS this offer's price (design D1, change
 * honest-trust-surfaces): the minimum over current offers is one
 * specific offer, and the aggregate resolves that offer's reliability
 * alongside the price.
 */
interface OfferPriceProvenance {
  readonly priceCents: number;
  readonly reliability: ReliabilityStatus;
}

/**
 * Pair the aggregate's price with its provenance. Null only when there
 * is no current offer (both fields are null together by construction).
 */
function cheapestOfferPrice(
  priceCents: number | null,
  reliabilityStatus: string | null,
): OfferPriceProvenance | null {
  return priceCents === null || reliabilityStatus === null
    ? null
    : { priceCents, reliability: toReliabilityStatus(reliabilityStatus) };
}

/**
 * The €/g metric embed for a search item (design D1, change
 * honest-trust-surfaces). Derived from the cheapest current-available
 * offer's price labeled with THAT offer's narrowed reliability — the
 * same freshness semantics the detail route's offer listing uses, so a
 * listing row and its detail page can never disagree. No current offer
 * → `MISSING_PRICE`: the price input is genuinely absent (a known
 * unknown, distinct from the domain's value-level faults). Missing or
 * invalid physicals and zero ethanol keep their domain reasons via the
 * module's precedence. No listing path passes NaN as the price.
 * Pack rows divide by the parsed package total (units from the name —
 * the same derivation the detail offers embed uses).
 */
function searchItemUnitPrice(
  inputs: UnitPriceInputs,
  price: OfferPriceProvenance | null,
): UnitPriceResult {
  return eurPerGram(
    price === null ? null : price.priceCents,
    inputs.unitVolumeL,
    inputs.alcoholFraction,
    price === null ? 'VERIFIED' : price.reliability,
    inputs.unitsPerPackage,
  );
}

/**
 * Base items without the embed, plus each product's parsed physical
 * inputs: the embed is computed at aggregate-merge time, when the
 * cheapest current offer's provenance is known. Keeping it out of the
 * base shape is also what preserves the legacy key order — eurPerGram
 * appends last, after the aggregates override their existing keys.
 */
function toSearchItems(products: readonly ProductRow[]): {
  items: SearchItem[];
  inputsById: Map<number, UnitPriceInputs>;
} {
  return {
    items: products.map(toSearchItem),
    inputsById: new Map(products.map((p) => [p.id, unitPriceInputs(p)])),
  };
}

/**
 * Map a catalog listing entry to the response shape with the page's real
 * offer aggregates (design D4, change product-catalog) and the €/g embed
 * derived from the entry's cheapest current offer (design D1, change
 * honest-trust-surfaces). The spread overrides keep the legacy key
 * order — lowestPriceCents/merchantCount already exist in the base
 * shape, so only their values change before the embed appends.
 */
function toCatalogItem(entry: CatalogProductListItem): SearchItemResponse {
  return {
    ...toSearchItem(entry.product),
    lowestPriceCents: entry.lowestPriceCents,
    merchantCount: entry.merchantCount,
    eurPerGram: searchItemUnitPrice(
      unitPriceInputs(entry.product),
      cheapestOfferPrice(
        entry.lowestPriceCents,
        entry.cheapestOfferReliabilityStatus,
      ),
    ),
  };
}

/**
 * One grouped aggregate row: per-product min price, merchant count, and
 * the cheapest current offer's reliability status — the provenance of
 * the row MIN landed on. The repository's catalog aggregate resolves
 * the identical column, so the ids/ranked-q paths cannot drift from
 * browse.
 */
interface OfferAggregateRow {
  readonly product_id: number;
  readonly min_price_cents: number;
  readonly merchant_count: number;
  readonly cheapest_reliability_status: string;
}

/**
 * Detail-parity offer aggregates for the given product ids — ONE grouped
 * query for the page (the ranked path returns up to MAX_PAGE_SIZE rows;
 * per-id findOffers calls would be N+1).
 *
 * The offer set is deliberately the SAME one the detail endpoint serves
 * (repo findOffers): retail_offers is append-per-scrape, so the latest
 * observation per (product, merchant) pair is its MAX(id) row. A
 * superseded cheaper scrape must not drag the row's minimum below what
 * the detail page lists (task 4.3 collapse parity). Over that set,
 * COUNT(DISTINCT merchant) equals the detail response's offers.length
 * and MIN(price_cents) equals its currentBestPriceCents. The catalog
 * browse path reads through the repository's listCatalogPage, which
 * applies the same latest-observation set (change
 * data-quality-and-publication-trust: the all-rows aggregate let a
 * pre-price-floor zero scrape crown the LOWEST_PRICE catalog).
 *
 * The provenance column is the shared
 * CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL fragment — the lowest-id row
 * among the min-price rows, which is the offer the detail route's own
 * lowest-current-offer derivation lands on.
 */
async function offerAggregatesByProductId(
  db: D1Database,
  productIds: readonly number[],
): Promise<Map<number, OfferAggregateRow>> {
  if (productIds.length === 0) return new Map();
  const inList = Array.from({ length: productIds.length }, () => '?').join(', ');
  const rows = (
    await db
      .prepare(
        `SELECT o.product_id AS product_id,
                MIN(o.price_cents) AS min_price_cents,
                COUNT(DISTINCT o.merchant) AS merchant_count,
                ${CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL} AS cheapest_reliability_status
           FROM retail_offers o
           JOIN (SELECT product_id, merchant, MAX(id) AS id
                   FROM retail_offers
                  WHERE product_id IN (${inList})
               GROUP BY product_id, merchant) m
             ON m.id = o.id
       GROUP BY o.product_id`,
      )
      .bind(...productIds)
      .all<OfferAggregateRow>()
  ).results;
  return new Map(rows.map((row) => [row.product_id, row]));
}

/**
 * Merge the aggregates into mapped items and compute each item's €/g
 * embed from the cheapest current offer (design D1). Offer-less
 * products keep the base shape's honest absence (null/0) and an embed
 * reporting MISSING_PRICE — only products with a latest offer row are
 * overridden.
 */
function withOfferAggregates(
  items: readonly SearchItem[],
  aggregates: Map<number, OfferAggregateRow>,
  inputsById: Map<number, UnitPriceInputs>,
): SearchItemResponse[] {
  return items.map((item) => {
    const aggregate = aggregates.get(item.id);
    return {
      ...item,
      ...(aggregate
        ? {
            lowestPriceCents: aggregate.min_price_cents,
            merchantCount: aggregate.merchant_count,
          }
        : {}),
      eurPerGram: searchItemUnitPrice(
        inputsById.get(item.id)!,
        aggregate
          ? cheapestOfferPrice(
              aggregate.min_price_cents,
              aggregate.cheapest_reliability_status,
            )
          : null,
      ),
    };
  });
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
  const category = c.req.query('category');
  const page = c.req.query('page');
  const limit = c.req.query('limit');

  const pageNum = parsePositiveInt(page, 1);
  const limitNum = Math.min(parsePositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  // Page offset for the fetch-then-slice paths (ids, ranked-q, and the
  // BIGGEST_SAVING browse branch below — all slice the sorted set here).
  const start = (pageNum - 1) * limitNum;
  // Raised outside the try below so the parameter error renders as its own
  // 400, never a wrapped 500 (unknown-category treatment parity).
  const sortBy = parseSortOrder(sort);

  // Category validation against the shared canonical set (design D2,
  // change product-catalog): an unknown value is a contract-level
  // parameter error — silently ignoring it is how the ignored-category
  // debt started. Blank counts as absent (unfiltered browse), matching
  // the q/ids blankness handling. Raised outside the try below so the
  // parameter error renders as its own 400, never a wrapped 500.
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
    const repo = new D1ProductSearchRepository(c.env.DB);
    // Display-only savings embed + BIGGEST_SAVING ordering (tasks 1.1
    // and 1.2, change savings-first-catalog-and-prefill, design D1/D3):
    // ONE full latest-day read per request, TWO uses — the sort map for
    // the default order and the embed lookup for the page's rows (the
    // savings routes' one-read-two-uses pattern; the full-day fetch is
    // safe at registry scale per the repository contract). The join
    // lives in this route file only — the product-search repository
    // imports no savings module. Items without a snapshot row for the
    // day keep the base shape — no placeholder, no zero. A
    // never-materialized day answers savingsAsOf: null (the honest zero
    // state, parity with the savings routes) and leaves every row
    // uncovered, so the default order degrades to the plain
    // alphabetical contract.
    const latestDay = await new D1SavingsSnapshotRepository(
      c.env.DB,
    ).findLatestDay();
    const snapshotByProductId = new Map(
      latestDay.map((row) => [row.productId, row] as const),
    );
    const savingsAsOf: string | null =
      latestDay.length > 0 ? latestDay[0]!.asOf : null;

    let items: SearchItemResponse[] = [];
    const query = q !== undefined ? q.trim() : '';
    // Set only on the browse path, where the repository owns pagination
    // (true totals, design D3); the ids and ranked-q paths keep
    // fetch-and-slice below.
    let catalogPage: CatalogProductListPage | undefined;
    // Set ONLY on the BIGGEST_SAVING browse branch, which sorts the full
    // matched key set with the snapshot map and slices the page itself:
    // the exact total is that key list's length, and the generic slice
    // below must not re-cut the already-page-sized items.
    let browseFullTotal: number | undefined;
    // Zero-result did-you-mean (task 3.2) — only the ranked-q path can
    // produce one; the ids path is not a text query and the browse path
    // paginates the catalog.
    let suggestion: string | null = null;

    if (ids !== undefined && ids.trim().length > 0) {
      // ID lookup takes precedence over free-text search (q ignored).
      const productIds = ids
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n) && n > 0);

      const products = await Promise.all(productIds.map((id) => repo.findById(id)));
      const found = products.filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
      // Base items plus inputs; the embed is computed when the aggregate
      // merge resolves each product's cheapest current offer.
      const { items: baseItems, inputsById } = toSearchItems(found);
      // Aggregates merge BEFORE ordering — LOWEST_PRICE sorts on them;
      // BIGGEST_SAVING (the absent-sort default since task 1.2, change
      // savings-first-catalog-and-prefill) sorts over the snapshot map;
      // ALPHABETICAL keeps the name order with the id tie.
      items = withOfferAggregates(
        baseItems,
        await offerAggregatesByProductId(
          c.env.DB,
          baseItems.map((item) => item.id),
        ),
        inputsById,
      );
      items.sort(compareBySortOrder(sortBy, snapshotByProductId));
    } else if (query.length > 0) {
      // Ranked search — combined category+q filtering (task 2.1, change
      // client-experience-improvement): the repository applies the
      // category together with the keyword, so the result set contains
      // only keyword matches in the category. The category is NEVER
      // silently ignored because q is present (spec product-search); the
      // sort — explicit, or the absent-sort BIGGEST_SAVING default (task
      // 1.2, change savings-first-catalog-and-prefill) — orders the
      // filtered set.
      //
      // searchRankedWithSuggestion (task 3.2) computes the advisory
      // did-you-mean only when the ranked search came back empty — a
      // non-empty result set leaves it null and skips the vocabulary
      // read entirely. The original query text is passed through
      // untouched; nothing here rewrites it.
      const ranked = await repo.searchRankedWithSuggestion(
        query,
        MAX_PAGE_SIZE,
        categoryParam,
      );
      suggestion = ranked.suggestion;
      // Base items plus inputs; the embed is computed when the aggregate
      // merge resolves each product's cheapest current offer.
      const { items: baseItems, inputsById } = toSearchItems(ranked.items);
      // Same pre-ordering aggregate merge as the ids path — the sort key
      // must be the real offer figure, never the null/0 placeholder.
      items = withOfferAggregates(
        baseItems,
        await offerAggregatesByProductId(
          c.env.DB,
          baseItems.map((item) => item.id),
        ),
        inputsById,
      );
      // Unconditional: the default (absent sort) is BIGGEST_SAVING too
      // (task 1.2, change savings-first-catalog-and-prefill), so the
      // keyword path orders deterministically by the resolved sort —
      // never the raw relevance order of the ranked fetch.
      items.sort(compareBySortOrder(sortBy, snapshotByProductId));
    } else if (sortBy === 'BIGGEST_SAVING') {
      // Savings-first browse (task 1.2, design D3): the gap order needs
      // every matching row's snapshot BEFORE the page is cut, so the
      // route fetches the full matched key set — the same narrow
      // (id, name) read the alphabetical contract sorts app-side, exposed
      // unsorted by listCatalogKeys (the repository's sort orders are
      // untouched; it never sees BIGGEST_SAVING) — orders it with the
      // snapshot map, and slices the page itself. Only the page's rows
      // are then hydrated (findById plus ONE grouped aggregate query —
      // the ids-path shape), so the full-set cost stays the key list's.
      const keys = await repo.listCatalogKeys(categoryParam);
      browseFullTotal = keys.length;
      const pageKeys = [...keys]
        .sort(compareByBiggestSavingThenId(snapshotByProductId))
        .slice(start, start + limitNum);
      const products = await Promise.all(
        pageKeys.map((key) => repo.findById(key.id)),
      );
      const found = products.filter(
        (p): p is NonNullable<typeof p> => p !== null,
      );
      const { items: baseItems, inputsById } = toSearchItems(found);
      // withOfferAggregates maps in place, so the items follow the sorted
      // key order — the comparator is a total order (gap, FI name, id),
      // which makes the mapping order the final order.
      items = withOfferAggregates(
        baseItems,
        await offerAggregatesByProductId(
          c.env.DB,
          baseItems.map((item) => item.id),
        ),
        inputsById,
      );
    } else {
      // Blank or absent q — the catalog listing (design D3, change
      // product-catalog): the repository paginates (exact totals, FI
      // collation; task 1.2 adds the objective sort orders). BIGGEST_
      // SAVING never reaches the repository — the branch above composes
      // it at route level.
      catalogPage = await repo.listCatalogPage(
        pageNum,
        limitNum,
        categoryParam,
        sortBy,
      );
      items = catalogPage.items.map(toCatalogItem);
    }

    const paginated =
      catalogPage !== undefined || browseFullTotal !== undefined
        ? items
        : items.slice(start, start + limitNum);
    const total =
      catalogPage !== undefined
        ? catalogPage.total
        : (browseFullTotal ?? items.length);

    // The ids/ranked-q paths merged their offer aggregates before the
    // sort above (bounded IN list over the fetched rows); the catalog
    // browse paths keep the repository's page aggregates (or, for the
    // BIGGEST_SAVING branch, the same one grouped query over the page's
    // ids — the ids-path shape).

    // Display-only savings embed (task 1.1, change
    // savings-first-catalog-and-prefill): a map lookup against the
    // request's ONE latest-day read (hoisted above — the BIGGEST_SAVING
    // sort consumes the same map; design D3, one read two uses). The
    // join never reorders the page — strictly additive per item. Items
    // without a snapshot row for that day keep the base shape — no
    // placeholder, no zero.
    const withSavings = paginated.map((item) => {
      const row = snapshotByProductId.get(item.id);
      return row === undefined ? item : { ...item, savings: toSavingsEmbed(row) };
    });

    // Additive merchantWarnings join (task 2.2): the merchants of this
    // page's products' offers, matched against PUBLISHED blacklist
    // entries. Strictly additive — items, ordering, and totals above are
    // computed before and untouched by the join; a failed lookup omits
    // the block (never an error, never a filtered item).
    const warnings = await getMerchantWarnings(
      c.env.DB,
      await merchantsForProducts(c.env.DB, paginated.map((item) => item.id)),
    );

    const payload: Record<string, unknown> = {
      items: withSavings,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      savingsAsOf,
    };
    // Advisory did-you-mean (task 3.2): strictly additive optional field —
    // attached only when the zero-result ranked search produced a
    // candidate within the edit-distance bound; absent (never null)
    // otherwise, like merchantWarnings below.
    if (suggestion !== null) {
      payload.suggestion = suggestion;
    }
    if (warnings !== undefined) {
      payload.merchantWarnings = warnings;
    }
    return c.json(payload);
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

    // The product page's best price (spec price-context / design D5):
    // the shared lowest-current-offer rule — the exact figure the
    // price-context route computes against, so the two surfaces can
    // never contradict each other.
    const currentBestPriceCents = lowestCurrentOfferPriceCents(offers);

    // Registry display names for the offer merchants (2.5, design D3):
    // one list read for the whole response, resolved BEFORE mapping so
    // every offer carries the same additive `merchantName` beside its
    // unchanged `merchant` identifier (the wire/analytics key).
    const names = await merchantDisplayNames(
      c.env.DB,
      offers.map((o) => o.merchant),
    );

    // Each offer carries the eurPerGram embed. The embed never reorders
    // the offers — it maps in place.
    // Physical inputs are per-product: parsed once and shared by every
    // offer's metric. unitVolume is litres as numeric text; an unparseable
    // value propagates as NaN → the module reports INVALID_VOLUME. The
    // ABV text is a fraction (0.047 = 4.7 %); absent → null → the module
    // reports MISSING_ALCOHOL_FRACTION. The pack units parse from the
    // product name (task 6.1 amendment) through the same parser the
    // listing embed uses, so a pack row's offers price the package, not
    // one can — and listing == detail on every pack row.
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
        // Additive display name (2.5): the registry name, or the raw id
        // when the merchant is unregistered — never null, never absent.
        merchantName: names.get(o.merchant) ?? o.merchant,
        country: o.country,
        priceCents: o.priceCents,
        currency: o.currency,
        availability: o.availability,
        sourceUrl: o.sourceUrl,
        observedAt:
          o.observedAt instanceof Date ? o.observedAt.toISOString() : String(o.observedAt),
        reliabilityStatus: o.reliabilityStatus,
        // Value offers inherit the offer price's reliability
        // (VERIFIED → computed, otherwise ESTIMATED); missing/invalid
        // inputs degrade to an explicit unavailable — never a
        // substituted value (spec unit-price-metrics). Pack rows pass
        // the name-parsed units so the denominator is the package total.
        eurPerGram: eurPerGram(
          o.priceCents,
          inputs.unitVolumeL,
          inputs.alcoholFraction,
          toReliabilityStatus(o.reliabilityStatus),
          inputs.unitsPerPackage,
        ),
      })),
      currentBestPriceCents,
    };

    // Informational per-merchant scores. The embed never reorders the
    // offers; an unavailable reliability store leaves the field absent.
    const offersList = response.offers as Array<{ merchant: string }>;

    // Additive merchantWarnings join (task 2.2): PUBLISHED blacklist
    // entries matching this product's offer merchants by domain OR
    // normalized name. Strictly additive — one extra top-level field;
    // the offers array, its order, and every calculated figure are built
    // before and never touched (spec merchant-blacklist). A failed
    // lookup omits the block rather than failing the response.
    const warnings = await getMerchantWarnings(
      c.env.DB,
      new Set(offersList.map((o) => o.merchant)),
    );
    if (warnings !== undefined) {
      response.merchantWarnings = warnings;
    }

    if (offersList.length > 0) {
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
  // Nest SearchController class age gate, method-scoped so the historical
  // controller's route (same prefix) keeps only its own guard set.
  for (const path of ['/api/v1/products', '/api/v1/products/:id']) {
    app.on('GET', path, ageGate());
  }

  app.get('/api/v1/products', search);
  app.get('/api/v1/products/:id', getProduct);
  return app;
}

export type { MerchantReliabilityMap };

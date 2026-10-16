/**
 * MCP tool layer (change seo-aeo-agent-surfaces, spec agent-tool-surface)
 * — the closed, strictly read-only tool set served at `/mcp`.
 *
 * CLOSED SET (spec "Tool list is the closed set"): exactly
 * `search_products`, `get_product`, `calculate_landed_cost`, versioned in
 * code below (`MCP_SERVER_INFO` + `MCP_TOOL_NAMES`). Unknown tool names
 * are rejected with a contract-level JSON-RPC error naming the valid
 * tools — never a silent fallback, never a generic error.
 *
 * PUBLIC DATA ONLY (spec "Public-data-only exposure"): every read below
 * composes the SAME exported building blocks the public routes compose —
 * the D1 product-search repository and its offer aggregates, the savings
 * snapshot read, the merchant registry / blacklist / reliability embeds,
 * and the landed-cost calculator over the published tax and transport
 * datasets. No account, session, favorites, alerts, or ops surface is
 * reachable; the tool input schema has no session field (sessionId stays
 * a web-session concept and never enters a tool call).
 *
 * STRICTLY READ-ONLY: the calculator runs with a NO-OP calculation-record
 * port — the service's persist step (landed-cost-calculator.service step
 * 8) writes nothing — and the idempotency cache layer is not consulted,
 * so a tool call touches zero tables and zero Durable Objects. The
 * never-persisted `calculationRecordId` key is dropped from the response
 * (render-nothing: no record exists, so no id is reported). The age gate
 * itself is enforced at the endpoint boundary (mcp.routes.ts), one level
 * above this layer — the tool layer adds no bypass and no second gate.
 *
 * Payload parity: each tool returns the same public payload shape the
 * corresponding route returns (POST /api/v1/calculator, GET
 * /api/v1/products/:id, GET /api/v1/products), re-composed from the same
 * exported pieces because the route files' internal helpers are not part
 * of this change's touch set. src/mcp/__tests__ pins tool↔route parity
 * on seeded data so the two compositions cannot drift silently.
 *
 * @module McpTools
 */

import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { eurPerGram } from '../../../../packages/core-domain/src/unitprice/eur-per-gram';
import type { UnitPriceResult } from '../../../../packages/core-domain/src/unitprice/unitprice.types';
import type { ReliabilityStatus } from '../../../../packages/core-domain/src/reliability/reliability.types';
import { parsePackUnits } from '../../../../packages/data-acquisition/src/services/pack-notation';
import type { CalculatorResult } from '../../../../packages/core-domain/src/calculator/calculator.types';
import {
  ClassificationGateService,
  AlcoholExciseService,
  ContainerDutyService,
  LandedCostCalculatorService,
  TransactionClassificationService,
  TransportClassificationService,
  TransportEstimationService,
  ConfidenceFrameworkService,
  ReliabilityService,
} from '../adapters/core-domain-bridge';
import type { ICalculationRecordPort } from '../../../../packages/core-domain/src/calculator/calculator.types';
import type { ITaxRuleRepositoryPort } from '../../../../packages/core-domain/src/tax/ports/tax-rule-repository.port';
import {
  D1ProductDataPort,
  D1TransportOfferQuery,
} from '../adapters/d1-domain-ports';
import { D1TravellerAllowancePort } from '../adapters/d1-traveller-allowance-port';
import { D1TravellerAllowancesRepository } from '../../../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import {
  D1TaxRuleRepositoryAdapter,
} from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import {
  readEmpiricalMarginLadder,
  resolveStoredCarrierById,
  withEmpiricalMargin,
} from '../routes/empirical-margin';
import type { AppEnv } from '../env';
import {
  CATALOG_SORT_ORDERS,
  CHEAPEST_CURRENT_OFFER_PROVENANCE_SQL,
  D1ProductSearchRepository,
  type CatalogProductListItem,
  type CatalogProductListPage,
  type CatalogSortOrder,
} from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1SavingsSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotRecord } from '../../../../packages/data-platform/src/abstracts';
import {
  PRODUCT_CATEGORIES,
} from '../../../../packages/data-platform/src/d1/schema';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import { lowestCurrentOfferPriceCents } from '../routes/current-best-price';
import {
  getMerchantWarnings,
  merchantsForProducts,
} from '../services/merchant-warnings';
import { getMerchantReliabilityMap } from '../services/merchant-reliability';

// ---------------------------------------------------------------------------
// Closed tool identity — versioned in code (spec "closed set, versioned
// in code"). `MCP_TOOL_NAMES` is the single source of truth for the list
// result AND the call-time membership check.
// ---------------------------------------------------------------------------

/** The closed tool set — exactly these three, nothing else. */
export const MCP_TOOL_NAMES = [
  'search_products',
  'get_product',
  'calculate_landed_cost',
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Server identity reported at initialize (change-scoped version). */
export const MCP_SERVER_INFO = {
  name: 'rajahinta-api',
  title: 'Rajahinta.fi public catalog & landed cost',
  version: '1.0.0',
} as const;

/** Route-parity pagination bounds (search.routes.ts constants). */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Input schemas — JSON Schema for tools/list; zod for call-time validation
// with the routes' exact error messages.
// ---------------------------------------------------------------------------

/** search_products: mirrors GET /api/v1/products (q, category, paging, sort). */
export const SEARCH_PRODUCTS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    q: {
      type: 'string',
      description:
        'Free-text product name query. Absent = the catalog listing.',
    },
    category: {
      type: 'string',
      enum: [...PRODUCT_CATEGORIES],
      description: 'Canonical category filter. Unknown values are rejected.',
    },
    page: {
      type: 'integer',
      minimum: 1,
      default: 1,
      description: '1-based page number.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: DEFAULT_PAGE_SIZE,
      description: 'Page size.',
    },
    sort: {
      type: 'string',
      enum: [...CATALOG_SORT_ORDERS],
      default: 'BIGGEST_SAVING',
      description: 'Listing order; absent resolves to BIGGEST_SAVING.',
    },
  },
  additionalProperties: false,
} as const;

/** get_product: mirrors GET /api/v1/products/:id. */
export const GET_PRODUCT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: {
      type: 'integer',
      minimum: 1,
      description: 'Product master id.',
    },
  },
  required: ['id'],
  additionalProperties: false,
} as const;

/**
 * calculate_landed_cost: mirrors POST /api/v1/calculator. `sessionId` is
 * deliberately absent — session linkage is a web-surface concept and the
 * tool surface carries no account or session fields.
 */
export const CALCULATE_LANDED_COST_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    productId: { type: 'integer', minimum: 1, description: 'Product master id.' },
    quantity: { type: 'integer', minimum: 1, description: 'Units to import.' },
    destination: {
      type: 'string',
      minLength: 2,
      maxLength: 2,
      description: 'ISO 3166-1 alpha-2 destination country code.',
    },
    transportMethod: { type: 'string', description: 'Optional transport method.' },
    transportArrangement: {
      type: 'string',
      enum: ['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'],
      description: 'Optional transport arrangement.',
    },
  },
  required: ['productId', 'quantity', 'destination'],
  additionalProperties: false,
} as const;

/** tools/list payload — derived from the same constants as the checks. */
export const MCP_TOOLS: readonly {
  name: McpToolName;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}[] = [
  {
    name: 'search_products',
    description:
      'Search or list the public product catalog: observed offers, lowest ' +
      'observed prices, merchant counts, per-item €/g metric and display-only ' +
      'savings context — the same data the public search endpoint returns.',
    inputSchema: SEARCH_PRODUCTS_INPUT_SCHEMA,
  },
  {
    name: 'get_product',
    description:
      'Fetch one product’s public detail: identity, attributes, the observed ' +
      'offers per merchant with per-offer €/g, and the current best price — ' +
      'the same payload the public product page renders.',
    inputSchema: GET_PRODUCT_INPUT_SCHEMA,
  },
  {
    name: 'calculate_landed_cost',
    description:
      'Estimate the landed cost of importing a product into Finland: itemized ' +
      'retail price, transport, alcohol excise, container duty, import VAT and ' +
      'confidence. Read-only estimate — nothing is stored. Returns the age-gate ' +
      'error when the caller has not confirmed age, exactly like the public API.',
    inputSchema: CALCULATE_LANDED_COST_INPUT_SCHEMA,
  },
];

// ---------------------------------------------------------------------------
// Call-time argument schemas (route-parity messages)
// ---------------------------------------------------------------------------

const searchArgsSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  page: z.number({ invalid_type_error: 'page must be a positive integer' }).int('page must be a positive integer').optional(),
  limit: z.number({ invalid_type_error: 'limit must be a positive integer' }).int('limit must be a positive integer').optional(),
  sort: z.string({ invalid_type_error: 'sort must be a string when provided' }).optional(),
});

const getProductArgsSchema = z.object({
  id: z
    .number({
      required_error: 'id must be a positive integer',
      invalid_type_error: 'id must be a positive integer',
    })
    .int('id must be a positive integer')
    .positive('id must be a positive integer'),
});

const calculateArgsSchema = z.object({
  productId: z
    .number({
      required_error: 'productId must be a positive integer',
      invalid_type_error: 'productId must be a positive integer',
    })
    .int('productId must be a positive integer')
    .positive('productId must be a positive integer'),
  quantity: z
    .number({
      required_error: 'quantity must be a positive integer',
      invalid_type_error: 'quantity must be a positive integer',
    })
    .int('quantity must be a positive integer')
    .positive('quantity must be a positive integer'),
  destination: z
    .string({
      required_error:
        'destination must be a 2-letter ISO 3166-1 alpha-2 country code',
      invalid_type_error:
        'destination must be a 2-letter ISO 3166-1 alpha-2 country code',
    })
    .length(
      2,
      'destination must be a 2-letter ISO 3166-1 alpha-2 country code',
    ),
  transportMethod: z
    .string({ invalid_type_error: 'transportMethod must be a string when provided' })
    .optional(),
  transportArrangement: z
    .enum(['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'], {
      invalid_type_error:
        'transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL',
    })
    .optional(),
});

/** Contract-level invalid-arguments error (route 400 message parity). */
function invalidArgs(message: string): McpError {
  return new McpError(ErrorCode.InvalidParams, message);
}

// ---------------------------------------------------------------------------
// search_products — a port of the GET /api/v1/products handler over the
// same exported building blocks (D1ProductSearchRepository paths, the
// savings snapshot's one-read-two-uses, merchant warnings). The ids path
// of the route is not exposed: get_product covers single-product reads.
// ---------------------------------------------------------------------------

/** Product row projection used by the search item mapping (route parity). */
interface ProductRow {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: string | null;
  readonly unitVolume: string;
  readonly containerType: string;
}

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

type SearchItemResponse = SearchItem & { eurPerGram: UnitPriceResult };

/** Route-parity savings embed (SavingsEmbedJson). */
interface SavingsEmbedJson {
  readonly landedTotalCents: number;
  readonly alkoReferenceCents: number | null;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly reliability: string;
  readonly confidence: string;
}

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

function parseLitres(raw: string): number {
  return Number.parseFloat(raw);
}

function parseAlcoholFraction(raw: string | null): number | null {
  return raw !== null ? Number.parseFloat(raw) : null;
}

const RELIABILITY_STATUSES: readonly string[] = [
  'VERIFIED',
  'STALE',
  'ESTIMATED',
  'UNAVAILABLE',
];

function toReliabilityStatus(raw: string): ReliabilityStatus {
  return RELIABILITY_STATUSES.includes(raw)
    ? (raw as ReliabilityStatus)
    : 'UNAVAILABLE';
}

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

interface OfferPriceProvenance {
  readonly priceCents: number;
  readonly reliability: ReliabilityStatus;
}

function cheapestOfferPrice(
  priceCents: number | null,
  reliabilityStatus: string | null,
): OfferPriceProvenance | null {
  return priceCents === null || reliabilityStatus === null
    ? null
    : { priceCents, reliability: toReliabilityStatus(reliabilityStatus) };
}

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

interface OfferAggregateRow {
  readonly product_id: number;
  readonly min_price_cents: number;
  readonly merchant_count: number;
  readonly cheapest_reliability_status: string;
}

/** Route-parity grouped offer aggregates (same SQL fragment, same set). */
async function offerAggregatesByProductId(
  db: AppEnv['Bindings']['DB'],
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

function toSearchItems(products: readonly ProductRow[]): {
  items: SearchItem[];
  inputsById: Map<number, UnitPriceInputs>;
} {
  return {
    items: products.map(toSearchItem),
    inputsById: new Map(products.map((p) => [p.id, unitPriceInputs(p)])),
  };
}

/** parsePositiveInt parity — invalid/absent values fall back. */
function parsePositiveInt(raw: number | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function compareByName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'fi');
}

function compareByNameThenId(
  a: { name: string; id: number },
  b: { name: string; id: number },
): number {
  return compareByName(a, b) || a.id - b.id;
}

function compareByLowestPriceThenId(a: SearchItem, b: SearchItem): number {
  if (a.lowestPriceCents === null || b.lowestPriceCents === null) {
    if (a.lowestPriceCents === b.lowestPriceCents) return a.id - b.id;
    return a.lowestPriceCents === null ? 1 : -1;
  }
  return a.lowestPriceCents - b.lowestPriceCents || a.id - b.id;
}

function compareByAlcoholDescThenId(a: SearchItem, b: SearchItem): number {
  if (a.alcoholByVolume === null || b.alcoholByVolume === null) {
    if (a.alcoholByVolume === b.alcoholByVolume) return a.id - b.id;
    return a.alcoholByVolume === null ? 1 : -1;
  }
  return b.alcoholByVolume - a.alcoholByVolume || a.id - b.id;
}

function compareByBiggestSavingThenId<T extends { id: number; name: string }>(
  snapshotByProductId: ReadonlyMap<number, SavingsSnapshotRecord>,
): (a: T, b: T) => number {
  return (a, b) => {
    const aRow = snapshotByProductId.get(a.id);
    const bRow = snapshotByProductId.get(b.id);
    if (aRow === undefined || bRow === undefined) {
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

/** Route-parity sort parsing (absent → BIGGEST_SAVING; unknown → error). */
function parseSortOrder(raw: string | undefined): CatalogSortOrder {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) return 'BIGGEST_SAVING';
  if ((CATALOG_SORT_ORDERS as readonly string[]).includes(trimmed)) {
    return trimmed as CatalogSortOrder;
  }
  throw invalidArgs(
    `Unknown sort '${trimmed}'. Valid sort orders: ${CATALOG_SORT_ORDERS.join(', ')}.`,
  );
}

/** Route-parity category parsing (blank = absent; unknown → error). */
function parseCategory(raw: string | undefined): string | undefined {
  const categoryParam =
    raw !== undefined && raw.trim().length > 0 ? raw : undefined;
  if (categoryParam !== undefined && !isCanonicalCategory(categoryParam)) {
    throw invalidArgs(
      `Unknown category '${categoryParam}'. Valid categories: ${PRODUCT_CATEGORIES.join(', ')}.`,
    );
  }
  return categoryParam;
}

function isCanonicalCategory(value: string): boolean {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

async function searchProductsPayload(
  db: AppEnv['Bindings']['DB'],
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const parsed = searchArgsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw invalidArgs(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const args = parsed.data;
  const pageNum = parsePositiveInt(args.page, 1);
  const limitNum = Math.min(parsePositiveInt(args.limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const start = (pageNum - 1) * limitNum;
  const sortBy = parseSortOrder(args.sort);
  const categoryParam = parseCategory(args.category);

  const repo = new D1ProductSearchRepository(db);
  // One latest-day read, two uses (route parity: the BIGGEST_SAVING sort
  // map and the display-only savings embeds).
  const latestDay = await new D1SavingsSnapshotRepository(db).findLatestDay();
  const snapshotByProductId = new Map(
    latestDay.map((row) => [row.productId, row] as const),
  );
  const savingsAsOf: string | null =
    latestDay.length > 0 ? latestDay[0]!.asOf : null;

  let items: SearchItemResponse[] = [];
  let catalogPage: CatalogProductListPage | undefined;
  let browseFullTotal: number | undefined;
  let suggestion: string | null = null;

  const query = args.q !== undefined ? args.q.trim() : '';
  if (query.length > 0) {
    const ranked = await repo.searchRankedWithSuggestion(
      query,
      MAX_PAGE_SIZE,
      categoryParam,
    );
    suggestion = ranked.suggestion;
    const { items: baseItems, inputsById } = toSearchItems(ranked.items);
    items = withOfferAggregates(
      baseItems,
      await offerAggregatesByProductId(db, baseItems.map((item) => item.id)),
      inputsById,
    );
    items.sort(compareBySortOrder(sortBy, snapshotByProductId));
  } else if (sortBy === 'BIGGEST_SAVING') {
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
    items = withOfferAggregates(
      baseItems,
      await offerAggregatesByProductId(db, baseItems.map((item) => item.id)),
      inputsById,
    );
  } else {
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

  const withSavings = paginated.map((item) => {
    const row = snapshotByProductId.get(item.id);
    return row === undefined ? item : { ...item, savings: toSavingsEmbed(row) };
  });

  const warnings = await getMerchantWarnings(
    db,
    await merchantsForProducts(db, paginated.map((item) => item.id)),
  );

  const payload: Record<string, unknown> = {
    items: withSavings,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    savingsAsOf,
  };
  if (suggestion !== null) {
    payload.suggestion = suggestion;
  }
  if (warnings !== undefined) {
    payload.merchantWarnings = warnings;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// get_product — a port of the GET /api/v1/products/:id handler (same
// batched read, same lowest-current-offer rule, same three display
// embeds, same 404 message).
// ---------------------------------------------------------------------------

/** Route-parity registry display names (fail-open to the raw id). */
async function merchantDisplayNames(
  db: AppEnv['Bindings']['DB'],
  merchants: readonly string[],
): Promise<Map<string, string>> {
  if (merchants.length === 0) return new Map();
  try {
    const rows = await new D1MerchantRegistryRepository(db).list();
    return new Map(rows.map((row) => [row.merchantId, row.name]));
  } catch {
    return new Map();
  }
}

async function getProductPayload(
  db: AppEnv['Bindings']['DB'],
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const parsed = getProductArgsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw invalidArgs(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const id = parsed.data.id;

  const repo = new D1ProductSearchRepository(db);
  const { product, offers } = await repo.findByIdWithOffers(id);
  if (product === null) {
    // Route-parity not-found: the message becomes the tool's isError
    // content (same text the 404 envelope carries).
    throw new Error(`Product ${id} not found`);
  }

  const currentBestPriceCents = lowestCurrentOfferPriceCents(offers);
  const merchants = new Set(offers.map((o) => o.merchant));

  const [names, warnings, embed] = await Promise.all([
    merchantDisplayNames(db, offers.map((o) => o.merchant)),
    getMerchantWarnings(db, merchants),
    offers.length > 0
      ? getMerchantReliabilityMap(db, merchants)
      : Promise.resolve(undefined),
  ]);

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
      // Additive SEO field (seo-aeo-agent-surfaces 1.1, route parity):
      // product_master.updated_at — the detail response's dateModified
      // source. Same key the public route serializes.
      updatedAt: product.updatedAt.toISOString(),
    },
    offers: offers.map((o) => ({
      id: o.id,
      merchant: o.merchant,
      merchantName: names.get(o.merchant) ?? o.merchant,
      country: o.country,
      priceCents: o.priceCents,
      currency: o.currency,
      availability: o.availability,
      sourceUrl: o.sourceUrl,
      observedAt:
        o.observedAt instanceof Date ? o.observedAt.toISOString() : String(o.observedAt),
      reliabilityStatus: o.reliabilityStatus,
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

  if (warnings !== undefined) {
    response.merchantWarnings = warnings;
  }
  if (embed !== undefined) {
    return { ...response, merchantReliability: embed };
  }
  return response;
}

// ---------------------------------------------------------------------------
// calculate_landed_cost — the POST /api/v1/calculator composition with a
// NO-OP calculation-record port and no idempotency layer: the estimate is
// computed fresh, nothing is stored anywhere, and the never-persisted
// `calculationRecordId` key is dropped (render-nothing). The empirical
// margin rides exactly like the route's read-time composition.
// ---------------------------------------------------------------------------

/**
 * Read-only record port — the service's persist step lands here and
 * writes nothing. The sentinel id is never reported (the key is dropped
 * from the response below).
 */
const NO_OP_CALCULATION_RECORD_PORT: ICalculationRecordPort = {
  async create(): Promise<{ id: number }> {
    return { id: 0 };
  },
};

/** The G3 composition over D1, with the persist step neutralized. */
export function buildReadonlyLandedCostCalculatorService(
  d1: AppEnv['Bindings']['DB'],
): { calculator: LandedCostCalculatorService; taxRepo: ITaxRuleRepositoryPort } {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  const calculator = new LandedCostCalculatorService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRepo),
    new ContainerDutyService(taxRepo),
    new TransactionClassificationService(new TransportClassificationService()),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1)),
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    NO_OP_CALCULATION_RECORD_PORT,
    new D1TravellerAllowancePort(new D1TravellerAllowancesRepository(d1)),
  );
  return { calculator, taxRepo };
}

async function calculateLandedCostPayload(
  db: AppEnv['Bindings']['DB'],
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const parsed = calculateArgsSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    throw invalidArgs(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const args = parsed.data;

  const { calculator } = buildReadonlyLandedCostCalculatorService(db);

  const result: CalculatorResult = await calculator.calculate({
    productId: args.productId,
    quantity: args.quantity,
    destination: args.destination,
    transportMethod: args.transportMethod,
    transportArrangement: args.transportArrangement,
  });

  // Route-parity read-time margin composition (empirical-margin.ts).
  const [ladder, carrier] = await Promise.all([
    readEmpiricalMarginLadder(db),
    resolveStoredCarrierById(db, result.metadata.transportOfferId),
  ]);
  const withMargin = withEmpiricalMargin(result, ladder, {
    category: result.metadata.category,
    carrier,
  });

  // No record was persisted, so the pointer key is never reported.
  const { calculationRecordId: _neverPersisted, ...payload } =
    withMargin as CalculatorResult & Record<string, unknown>;
  return payload;
}

// ---------------------------------------------------------------------------
// Dispatch — the closed-set membership check IS the contract boundary.
// ---------------------------------------------------------------------------

/**
 * Validate the tool name against the closed set, then run the read.
 *
 * Unknown names throw the contract-level error naming the valid tools
 * (spec "Unknown tool rejected"). Domain errors (product not found, gate
 * rejections, no published allowances) propagate to the caller — the
 * endpoint layer renders them as tool-execution errors (`isError`) with
 * the routes' exact messages.
 */
export async function dispatchMcpTool(
  name: string,
  args: unknown,
  db: AppEnv['Bindings']['DB'],
): Promise<Record<string, unknown>> {
  if (!(MCP_TOOL_NAMES as readonly string[]).includes(name)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown tool '${name}'. Valid tools: ${MCP_TOOL_NAMES.join(', ')}.`,
    );
  }
  switch (name as McpToolName) {
    case 'search_products':
      return searchProductsPayload(db, args);
    case 'get_product':
      return getProductPayload(db, args);
    case 'calculate_landed_cost':
      return calculateLandedCostPayload(db, args);
  }
}

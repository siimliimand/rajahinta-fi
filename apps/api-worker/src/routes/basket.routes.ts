/**
 * Basket optimizer route port (task 3.6) — Hono re-host of
 * BasketOptimizerController (packages/application-api/src/basket/).
 *
 * Guard/rate-limit composition (Nest decoration order preserved):
 *   POST /api/v1/basket/optimize   RateLimit(BASKET) → FeatureFlag(BASKET_OPTIMIZATION)
 *
 * The optimizer runs the REAL BasketOptimizerService over the D1 port
 * adapters (product data + merchant terms + basket-calculation records —
 * src/adapters/d1-domain-ports.ts), idempotency-wrapped through
 * IdempotencyDO under the `basket:` string-keyspace with lookup-time
 * dataset-version checks, exactly like the Nest controller's
 * IIdempotencyCache flow.
 *
 * While PACKING_OPTIMIZER is on (task 3.3), the response additionally
 * carries an advisory `packing` section (PackingSuggestion) computed
 * from the curated product_dimensions / carrier_box_types tables; the
 * flag gates the section, never the endpoint.
 *
 * @module BasketRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { FeatureFlag, FeatureFlagService } from '../middleware/feature-flags';
import { suggestPacking } from '../../../../packages/core-domain/src/packing/packing';
import type {
  PackingItem,
  PackingSuggestion,
} from '../../../../packages/core-domain/src/packing/packing.types';
import { D1ProductDimensionsRepository } from '../../../../packages/data-platform/src/repositories/d1/product-dimensions.repository';
import { D1CarrierBoxTypesRepository } from '../../../../packages/data-platform/src/repositories/d1/carrier-box-types.repository';
import {
  BasketOptimizerService,
  BasketShippingCalculator,
  BasketValidationError,
  BasketClassificationGateError,
  BasketCombinationLimitError,
  MAX_BASKET_ITEMS,
  TransportEstimationService,
} from '../adapters/core-domain-bridge';
import type {
  BasketOptimizationResult,
  BasketOptimizationInput,
} from '../../../../packages/core-domain/src/optimizer/optimizer.types';
import type { TransportArrangement } from '../../../../packages/core-domain/src/calculator/calculator.types';
import {
  D1ProductDataPort,
  D1TransportOfferQuery,
  D1MerchantTermsPort,
  D1BasketCalculationRecordPort,
  D1CalculationRecordPort,
} from '../adapters/d1-domain-ports';
import {
  idempotencyCacheKey,
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';
import { D1TaxRuleRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import type { ITaxRuleRepositoryPort } from '../../../../packages/core-domain/src/tax/ports/tax-rule-repository.port';
import {
  LandedCostCalculatorService,
  ClassificationGateService,
  AlcoholExciseService,
  ContainerDutyService,
  TransactionClassificationService,
  TransportClassificationService,
  ConfidenceFrameworkService,
  ReliabilityService,
} from '../adapters/core-domain-bridge';

/** Composition — optimizer over its D1 ports (per request). */
export function buildBasketOptimizerService(d1: AppEnv['Bindings']['DB']): {
  optimizer: BasketOptimizerService;
  taxRepo: ITaxRuleRepositoryPort;
} {
  const taxRepo = new D1TaxRuleRepositoryAdapter(d1);
  const calculator: LandedCostCalculatorService = new LandedCostCalculatorService(
    new ClassificationGateService(),
    new AlcoholExciseService(taxRepo),
    new ContainerDutyService(taxRepo),
    new TransactionClassificationService(new TransportClassificationService()),
    new TransportEstimationService(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1)),
    ),
    new ConfidenceFrameworkService(new ReliabilityService()),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1CalculationRecordPort(d1),
  );

  const optimizer = new BasketOptimizerService(
    new ClassificationGateService(),
    calculator,
    new BasketShippingCalculator(
      new D1TransportOfferQuery(new D1TransportOfferRepository(d1)),
    ),
    new D1ProductDataPort(new D1ProductSearchRepository(d1)),
    new D1MerchantTermsPort(d1),
    new D1BasketCalculationRecordPort(d1),
    new ConfidenceFrameworkService(new ReliabilityService()),
  );
  return { optimizer, taxRepo };
}

// ---------------------------------------------------------------------------
// Packing section (task 3.3) — advisory box suggestion behind
// PACKING_OPTIMIZER, attached to the optimize response at read time
// ---------------------------------------------------------------------------

/** Optimize response — the optimizer result plus the flag-gated packing section. */
type BasketOptimizeResponse = BasketOptimizationResult & {
  readonly packing?: PackingSuggestion;
};

/**
 * Build the packing suggestion for the requested basket lines (task 3.3).
 *
 * Purely advisory: product dimensions and the box catalogue are curated
 * D1 tables the optimizer itself never reads, so a basket that optimizes
 * fine can still pack as ESTIMATED. Absence of a `product_dimensions`
 * row maps to the all-null physical fields — the packing module then
 * excludes the line with reason MISSING_DIMENSIONS (spec:
 * missing-dimensions-degrade-explicitly) instead of failing the request;
 * an empty `carrier_box_types` catalogue degrades the same way with
 * reason NO_FITTING_BOX. The record→input mapping is field-for-field:
 * task 3.2 shaped the module's CarrierBoxType/PackingItem inputs
 * structurally identical to the repository rows minus provenance columns.
 */
async function buildPackingSection(
  d1: AppEnv['Bindings']['DB'],
  lines: ReadonlyArray<{ readonly productId: number; readonly quantity: number }>,
): Promise<PackingSuggestion> {
  const [dimensions, boxTypes] = await Promise.all([
    new D1ProductDimensionsRepository(d1).findByProductIds(lines.map((line) => line.productId)),
    new D1CarrierBoxTypesRepository(d1).listAll(),
  ]);
  const byProductId = new Map(dimensions.map((dimension) => [dimension.productId, dimension]));
  const packingItems: PackingItem[] = lines.map((line) => {
    const dimension = byProductId.get(line.productId);
    return {
      productId: line.productId,
      quantity: line.quantity,
      weightG: dimension?.weightG ?? null,
      heightMm: dimension?.heightMm ?? null,
      diameterMm: dimension?.diameterMm ?? null,
      material: dimension?.material ?? null,
    };
  });
  return suggestPacking(packingItems, boxTypes);
}

/** Attach the packing section only when the flag resolved on — the key stays absent otherwise. */
function withPackingSection(
  result: BasketOptimizationResult,
  packing: PackingSuggestion | undefined,
): BasketOptimizeResponse {
  return packing === undefined ? result : { ...result, packing };
}

// ---------------------------------------------------------------------------
// POST /api/v1/basket/optimize — imperative validation mirroring
// validateOptimizeRequest 1:1 (indexed item messages, joined '; ' order)
// ---------------------------------------------------------------------------

interface BasketItemInput {
  readonly productId: number;
  readonly quantity: number;
}

interface BasketOptimizeDto {
  readonly items: BasketItemInput[];
  readonly destination: string;
  readonly transportMethod?: string;
  readonly transportArrangement?: string;
  readonly sessionId?: string;
}

/**
 * Verbatim port of the controller's validateOptimizeRequest — same checks,
 * same order, same joined message, same 400 ValidationError payload.
 */
function validateOptimizeRequest(dto: BasketOptimizeDto): void {
  const errors: string[] = [];

  // Items
  if (!Array.isArray(dto.items)) {
    errors.push('items must be an array');
  } else {
    if (dto.items.length < 1) {
      errors.push('items must contain at least 1 item');
    } else if (dto.items.length > MAX_BASKET_ITEMS) {
      errors.push(`items must contain at most ${MAX_BASKET_ITEMS} items`);
    }

    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      if (
        typeof item !== 'object' ||
        item === null ||
        !Number.isInteger(item.productId) ||
        item.productId <= 0
      ) {
        errors.push(`items[${i}].productId must be a positive integer`);
      }
      if (
        typeof item !== 'object' ||
        item === null ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        errors.push(`items[${i}].quantity must be a positive integer between 1 and 99`);
      }
    }
  }

  // Destination
  if (typeof dto.destination !== 'string' || dto.destination.length !== 2) {
    errors.push('destination must be a 2-letter ISO 3166-1 alpha-2 country code');
  }

  // Optional fields
  if (dto.transportMethod !== undefined && typeof dto.transportMethod !== 'string') {
    errors.push('transportMethod must be a string when provided');
  }
  if (
    dto.transportArrangement !== undefined &&
    !['SELLER_ARRANGED', 'INDEPENDENT_CARRIER', 'PERSONAL'].includes(dto.transportArrangement)
  ) {
    errors.push(
      'transportArrangement must be one of: SELLER_ARRANGED, INDEPENDENT_CARRIER, PERSONAL',
    );
  }
  if (dto.sessionId !== undefined && typeof dto.sessionId !== 'string') {
    errors.push('sessionId must be a string when provided');
  }

  if (errors.length > 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: errors.join('; '),
      error: 'ValidationError',
    });
  }
}

/** Parse the JSON body without schema enforcement — validation is manual. */
async function parseRawBody(c: Context): Promise<BasketOptimizeDto> {
  try {
    return (await c.req.json()) as BasketOptimizeDto;
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }
}

async function optimize(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseRawBody(c);
  validateOptimizeRequest(dto);

  const input: BasketOptimizationInput = {
    items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    transportArrangement: dto.transportArrangement as TransportArrangement | undefined,
    sessionId: dto.sessionId,
  };

  // Idempotency: `basket:`-namespaced string key (single-product
  // dimensions zeroed — CacheKeyInput parity with the Nest controller).
  const idempotencyKey = c.req.header('x-idempotency-key');
  const rawKey = await idempotencyCacheKey({
    productId: 0,
    quantity: 0,
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    items: dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
  });
  const cacheKey = idempotencyKey ?? `basket:${rawKey}`;

  const { optimizer, taxRepo } = buildBasketOptimizerService(c.env.DB);
  const currentVersions = await taxRepo.findActiveVersionLabels();

  // PACKING_OPTIMIZER gates the response SECTION, not the endpoint
  // (per-request resolution, search.routes pattern): off → the response
  // keeps its exact flag-less shape, no `packing` key at all. The
  // suggestion is computed per request from the curated tables and
  // attached to both MISS and HIT payloads — the idempotency cache
  // stores the flag-agnostic optimizer result only, so X-Content-Hash
  // keeps identifying the optimization regardless of section visibility.
  const includePacking = new FeatureFlagService(c.env).isEnabled(
    FeatureFlag.PACKING_OPTIMIZER,
  );
  const packing = includePacking
    ? await buildPackingSection(
        c.env.DB,
        dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      )
    : undefined;

  const cached = await idempotencyLookup(c.env, cacheKey, currentVersions);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(withPackingSection(cached.result as BasketOptimizationResult, packing));
  }

  try {
    const result: BasketOptimizationResult = await optimizer.optimize(input);

    // Nest storeCached: prefer the result's own versions, fall back to
    // the current labels.
    await idempotencyStore(c.env, cacheKey, result, {
      datasetVersions:
        result.metadata.datasetVersions.length > 0
          ? result.metadata.datasetVersions
          : currentVersions,
    });

    c.header('X-Cache', 'MISS');
    c.header('X-Content-Hash', await idempotencyContentHash(result));
    return c.json(withPackingSection(result, packing));
  } catch (err) {
    if (err instanceof BasketValidationError) {
      // Specific codes map to 404; the rest carry the validation payload.
      if (err.code === 'PRODUCT_NOT_FOUND' || err.code === 'NO_OFFERS') {
        throw new ApiHttpError(404, err.message);
      }
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'BasketValidationError',
        code: err.code,
      });
    }
    if (err instanceof BasketClassificationGateError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: 'BasketClassificationGateRejection',
        productId: err.productId,
      });
    }
    if (err instanceof BasketCombinationLimitError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: 'BasketCombinationLimitExceeded',
        totalCombinations: err.totalCombinations,
        limit: err.limit,
      });
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Unexpected basket optimization error',
    );
  }
}

/** Register the basket handler (flag guard pre-registered by task 3.2). */
export function registerBasketRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // BASKET_OPTIMIZATION flag: class-level prefix from registerGuardMiddleware.
  app.post('/api/v1/basket/optimize', optimize);
  return app;
}

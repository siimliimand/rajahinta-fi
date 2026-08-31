/**
 * Calculator + legacy calculations route ports (task 3.5) — Hono re-host
 * of CalculatorController (packages/application-api/src/calculator/) and
 * CalculationController (…/calculations/).
 *
 * Guard/rate-limit composition (Nest decoration order preserved):
 *   POST /api/v1/calculator          RateLimit(CALCULATOR) → LaunchGate(CALCULATION)
 *                                    → AgeGate   (prefix, tasks 3.2/3.5)
 *   GET  /api/v1/calculator/result/:recordId   LaunchGate → AgeGate
 *   POST /api/v1/calculations/excise|landed-cost   RateLimit(CALCULATOR) → AgeGate
 *
 * The calculator runs the REAL LandedCostCalculatorService over the D1
 * port adapters (G3 composition — see src/adapters/d1-domain-ports.ts),
 * idempotency-wrapped through IdempotencyDO exactly where the Nest
 * controller uses IdempotencyService: version-aware derived keys,
 * verbatim client keys, X-Cache / X-Content-Hash headers.
 *
 * @module CalculatorRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseDto, parseIntParam } from './support';
import {
  LandedCostCalculatorService,
  ClassificationGateService,
  AlcoholExciseService,
  ContainerDutyService,
  TransactionClassificationService,
  TransportClassificationService,
  TransportEstimationService,
  ConfidenceFrameworkService,
  ReliabilityService,
  ProductNotFoundError,
  NoRetailOffersError,
  ClassificationGateRejectionError,
  DISCLAIMER_FI,
} from '../adapters/core-domain-bridge';
import type { CalculatorResult } from '../../../../packages/core-domain/src/calculator/calculator.types';
import type { ITaxRuleRepositoryPort } from '../../../../packages/core-domain/src/tax/ports/tax-rule-repository.port';
import type { ExciseResult } from '../../../../packages/core-domain/src/tax/services/alcohol-excise.service';
import type { ContainerDutyResult } from '../../../../packages/core-domain/src/tax/services/container-duty.service';
import {
  D1ProductDataPort,
  D1TransportOfferQuery,
  D1CalculationRecordPort,
} from '../adapters/d1-domain-ports';
import {
  idempotencyCacheKey,
  idempotencyLookup,
  idempotencyStore,
  idempotencyContentHash,
} from '../adapters/idempotency-facade';
import {
  D1TaxRuleRepositoryAdapter,
  D1TaxRateRepository,
} from '../../../../packages/data-platform/src/repositories/d1/tax-rate.repository';
import { D1CalculationRecordRepository } from '../../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import { mapCalculationRecordToResult } from '../../../../packages/application-api/src/calculator/calculation-result.mapper';

/** Composition — the G3 vertical-slice wiring over D1 (per request). */
export function buildLandedCostCalculatorService(d1: AppEnv['Bindings']['DB']): {
  calculator: LandedCostCalculatorService;
  taxRepo: ITaxRuleRepositoryPort;
} {
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
    new D1CalculationRecordPort(d1),
  );
  return { calculator, taxRepo };
}

// ---------------------------------------------------------------------------
// POST /api/v1/calculator — zod schema mirroring validateCalculateRequest
// ---------------------------------------------------------------------------

const calculateRequestSchema = z.object({
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
  sessionId: z
    .string({ invalid_type_error: 'sessionId must be a string when provided' })
    .optional(),
});

/** POST /api/v1/calculator handler (calculator.controller.calculate parity). */
async function calculate(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, calculateRequestSchema);

  const idempotencyKey = c.req.header('x-idempotency-key');
  const input = {
    productId: dto.productId,
    quantity: dto.quantity,
    destination: dto.destination,
    transportMethod: dto.transportMethod,
    transportArrangement: dto.transportArrangement,
    sessionId: dto.sessionId,
  };

  const { calculator, taxRepo } = buildLandedCostCalculatorService(c.env.DB);

  // Version-aware key — versions resolved FIRST (§15 known-issue fix kept).
  const currentVersions = await taxRepo.findActiveVersionLabels();
  const cacheKey =
    idempotencyKey ??
    (await idempotencyCacheKey({ ...input, datasetVersions: currentVersions }));

  const cached = await idempotencyLookup(c.env, cacheKey, currentVersions);
  if (cached !== null) {
    c.header('X-Cache', 'HIT');
    c.header('X-Content-Hash', await idempotencyContentHash(cached.result));
    return c.json(cached.result);
  }

  try {
    const result: CalculatorResult = await calculator.calculate(input);

    // store() parity: the entry's versions come from the result metadata.
    await idempotencyStore(c.env, cacheKey, result);

    c.header('X-Cache', 'MISS');
    c.header('X-Content-Hash', await idempotencyContentHash(result));
    return c.json(result);
  } catch (err) {
    if (err instanceof ProductNotFoundError || err instanceof NoRetailOffersError) {
      throw new ApiHttpError(404, err.message);
    }
    if (err instanceof ClassificationGateRejectionError) {
      throw new ApiHttpError(422, {
        statusCode: 422,
        message: err.message,
        error: 'ClassificationGateRejection',
        productId: err.productId,
        reason: err.reason,
      });
    }
    throw new ApiHttpError(
      500,
      err instanceof Error ? err.message : 'Unexpected calculation error',
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/calculator/result/:recordId
// ---------------------------------------------------------------------------

async function getResult(c: Context<AppEnv>): Promise<Response> {
  const recordId = parseIntParam(c, 'recordId');
  const d1 = c.env.DB;

  const record = await new D1CalculationRecordRepository(d1).findById(recordId);
  if (record === null) {
    throw new ApiHttpError(404, `Calculation record ${recordId} not found`);
  }

  // Read-side joins only — no engine runs, no price/tax recomputation.
  const taxRepo = new D1TaxRateRepository(d1);
  const [product, exciseRule, containerRule] = await Promise.all([
    new D1ProductSearchRepository(d1).findById(record.productMasterId),
    record.exciseRuleVersionId !== null
      ? taxRepo.findVersionById(record.exciseRuleVersionId)
      : Promise.resolve(null),
    record.containerDutyRuleVersionId !== null
      ? taxRepo.findVersionById(record.containerDutyRuleVersionId)
      : Promise.resolve(null),
  ]);

  return c.json(
    mapCalculationRecordToResult({
      record,
      product,
      exciseVersionLabel: exciseRule?.versionLabel ?? null,
      containerVersionLabel: containerRule?.versionLabel ?? null,
    }),
  );
}

// ---------------------------------------------------------------------------
// POST /api/v1/calculations/excise and /landed-cost — legacy controllers
// ---------------------------------------------------------------------------

const EXCISE_CATEGORIES = ['beer', 'wine', 'spirits', 'intermediate', 'other'] as const;
const CONTAINER_TYPES = ['glass', 'plastic', 'metal', 'carton', 'other'] as const;
const TRANSACTION_CLASSES = ['distance-selling', 'distance-buying', 'traveller-import'] as const;

const exciseBaseSchema = z.object({
  category: z.enum(EXCISE_CATEGORIES, {
    errorMap: () => ({
      message: `category must be one of: ${EXCISE_CATEGORIES.join(', ')}`,
    }),
  }),
  volumeLitres: z
    .number({
      required_error: 'volumeLitres must be a positive number',
      invalid_type_error: 'volumeLitres must be a positive number',
    })
    .positive('volumeLitres must be a positive number'),
  alcoholByVolume: z
    .number({
      required_error:
        'alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
      invalid_type_error:
        'alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
    })
    .min(
      0,
      'alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
    )
    .max(
      1,
      'alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
    ),
});

const landedCostSchema = z.object({
  retailPriceCents: z
    .number({
      required_error: 'retailPriceCents must be a non-negative integer',
      invalid_type_error: 'retailPriceCents must be a non-negative integer',
    })
    .int('retailPriceCents must be a non-negative integer')
    .min(0, 'retailPriceCents must be a non-negative integer'),
  transportCostCents: z
    .number({
      required_error: 'transportCostCents must be a non-negative integer',
      invalid_type_error: 'transportCostCents must be a non-negative integer',
    })
    .int('transportCostCents must be a non-negative integer')
    .min(0, 'transportCostCents must be a non-negative integer'),
  // The controller does not field-check exciseBase in
  // validateLandedCostRequest — its internals only surface through the
  // 'exciseBase: '-prefixed nested message (validateLandedCost below).
  exciseBase: z.unknown().optional(),
  containerType: z
    .enum(CONTAINER_TYPES, {
      errorMap: () => ({
        message: `containerType must be one of: ${CONTAINER_TYPES.join(', ')}, or null`,
      }),
    })
    .nullable(),
  containerVolumeLitres: z
    .number({
      invalid_type_error:
        'containerVolumeLitres must be a positive number when containerType is present',
    })
    .positive(
      'containerVolumeLitres must be a positive number when containerType is present',
    )
    .nullable()
    .optional(),
  depositSystemVerified: z
    .boolean({
      invalid_type_error: 'depositSystemVerified must be a boolean',
    })
    .nullable()
    .optional(),
  transactionClass: z.enum(TRANSACTION_CLASSES, {
    errorMap: () => ({
      message: `transactionClass must be one of: ${TRANSACTION_CLASSES.join(', ')}`,
    }),
  }),
});

/** Domain results → the published ExciseCalculation shape (controller parity). */
function mapExciseResult(
  base: { category: string },
  result: ExciseResult,
): Record<string, unknown> {
  return {
    exciseAmountCents: result.taxCents,
    category: base.category,
    rateVersionId: result.taxDatasetVersion,
    calculatedAt: new Date(),
    evidence: {
      volumeLitres: result.volumeLitres,
      alcoholByVolume: result.abv,
      rateAppliedCentsPerUnit: Math.round(result.rateApplied * 100),
    },
  };
}

function mapContainerDutyResult(
  containerType: string,
  result: ContainerDutyResult,
): Record<string, unknown> {
  return {
    dutyAmountCents: result.dutyCents,
    reliability: result.reliability === 'VERIFIED' ? 'EXACT' : 'ESTIMATED',
    evidence: {
      containerType,
      volumeLitres: result.volumeLitres,
      rateAppliedCentsPerLitre: Math.round(result.ratePerLitre * 100),
      depositExemptionApplied: result.depositExemption?.exempted ?? false,
    },
  };
}

type LandedCostDto = z.infer<typeof landedCostSchema>;
type ExciseBaseDto = z.infer<typeof exciseBaseSchema>;

/**
 * Landed-cost validation — the controller's cross-field rules (container
 * volume/deposit required with containerType; nested exciseBase checks
 * prefixed into the message) run after the schema parse.
 */
function validateLandedCost(dto: LandedCostDto): void {
  const errors: string[] = [];

  if (dto.containerType !== null) {
    if (
      typeof dto.containerVolumeLitres !== 'number' ||
      !Number.isFinite(dto.containerVolumeLitres) ||
      dto.containerVolumeLitres <= 0
    ) {
      errors.push(
        'containerVolumeLitres must be a positive number when containerType is present',
      );
    }
    if (typeof dto.depositSystemVerified !== 'boolean') {
      errors.push('depositSystemVerified must be a boolean');
    }
  }
  if (dto.exciseBase !== null && dto.exciseBase !== undefined) {
    const result = exciseBaseSchema.safeParse(dto.exciseBase);
    if (!result.success) {
      const nested = result.error.issues.map((issue) => issue.message).join('; ');
      errors.push(`exciseBase: ${nested}`);
    }
  }

  if (errors.length > 0) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: errors.join('; '),
      error: 'ValidationError',
    });
  }
}

/** Narrow the validated exciseBase (post-validation, controller parity). */
function exciseBaseOf(dto: LandedCostDto): ExciseBaseDto | null {
  return dto.exciseBase === null || dto.exciseBase === undefined
    ? null
    : (dto.exciseBase as ExciseBaseDto);
}

async function calculateExcise(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, exciseBaseSchema);
  const exciseService = new AlcoholExciseService(new D1TaxRuleRepositoryAdapter(c.env.DB));
  const result = await exciseService.calculate(
    dto.category,
    dto.alcoholByVolume,
    dto.volumeLitres,
  );
  return c.json(mapExciseResult(dto, result));
}

async function calculateLandedCost(c: Context<AppEnv>): Promise<Response> {
  const dto = await parseDto(c, landedCostSchema);
  validateLandedCost(dto);

  const taxRepo = new D1TaxRuleRepositoryAdapter(c.env.DB);
  const exciseService = new AlcoholExciseService(taxRepo);
  const containerDutyService = new ContainerDutyService(taxRepo);

  const exciseBase = exciseBaseOf(dto);
  const exciseDuty =
    exciseBase !== null
      ? mapExciseResult(
          exciseBase,
          await exciseService.calculate(
            exciseBase.category,
            exciseBase.alcoholByVolume,
            exciseBase.volumeLitres,
          ),
        )
      : null;

  const containerDuty =
    dto.containerType !== null
      ? mapContainerDutyResult(
          dto.containerType,
          await containerDutyService.calculate(
            dto.containerVolumeLitres as number,
            dto.containerType,
            dto.depositSystemVerified as boolean,
          ),
        )
      : null;

  return c.json({
    retailPriceCents: dto.retailPriceCents,
    transportCostCents: dto.transportCostCents,
    exciseDuty,
    containerDuty,
    totalCostCents:
      dto.retailPriceCents +
      dto.transportCostCents +
      ((exciseDuty as { exciseAmountCents: number } | null)?.exciseAmountCents ?? 0) +
      ((containerDuty as { dutyAmountCents: number } | null)?.dutyAmountCents ?? 0),
    currency: 'EUR',
    disclaimer: DISCLAIMER_FI,
    calculationTimestamp: new Date(),
    transactionClass: dto.transactionClass,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the calculator/calculation handlers (guards pre-registered). */
export function registerCalculatorRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/calculator', calculate);
  app.get('/api/v1/calculator/result/:recordId', getResult);
  app.post('/api/v1/calculations/excise', calculateExcise);
  app.post('/api/v1/calculations/landed-cost', calculateLandedCost);
  return app;
}


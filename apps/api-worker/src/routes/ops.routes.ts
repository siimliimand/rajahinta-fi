/**
 * Operator-console API port (task 3.8) — Hono re-host of the four ops
 * console controllers (packages/application-api/src/ops/): governance
 * grants, dataset confirmations (incl. FX publish), the correction queue,
 * and the audit trail. Task 5.3 (change product-roadmap-phases-1-4)
 * adds the ferry-offer CRUD — the curated affiliate slot's audited
 * management surface (design R8).
 *
 * Guard composition (3.2 route-coverage map): the /ops/console/* prefix
 * already carries opsAccess() → requireFeatureFlag('OPERATOR_CONSOLE') —
 * deny BEFORE any operational data. Operator identity for the audit trail
 * travels in each mutating request body (`operator`), as in Nest.
 *
 * EVERY mutating action writes an append-only D1 `audit_events` row via
 * the task-2.5 D1AuditEventRepository (WorkerAuditService).
 *
 * ## Fail-closed stores (documented scope note, task 3.8)
 *
 * - FX datasets resolve against the D1 fx-rate repositories (2.5) — the
 *   confirmation queue lists and publishes for real.
 * - Tax rate-review entries and the source-governance table have NO D1
 *   counterpart yet (2.5 ported sessions, audit, watermarks, registry).
 *   The permission state therefore cannot resolve from storage, so
 *   governance reads fail closed to PENDING (permission never overstated
 *   — identical to the Nest service's unwired-port path) and the
 *   rate-review / governance / correction WRITES reject with 503 rather
 *   than fabricating persistence. This mirrors the phase-1 backend, where
 *   the same stores are in-memory or null-ported.
 *
 * @module OpsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { WorkerAuditService } from '../adapters/audit';
import { idempotencyInvalidateVersions } from '../do/client';
import { FxRateDatasetService } from '../adapters/core-domain-bridge';
import { D1FxRateDatasetRepositoryAdapter } from '../../../../packages/data-platform/src/repositories/d1/fx-rate-port.adapter';
import { D1FxRateRepository } from '../../../../packages/data-platform/src/repositories/d1/fx-rate.repository';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import {
  D1ConsumptionNormsRepository,
  MissingNormSourceCitationError,
} from '../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import {
  D1FerryOffersRepository,
  FerryOfferImmutableError,
} from '../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

// ---------------------------------------------------------------------------
// Shared validation (imperative-operator checks, controller parity)
// ---------------------------------------------------------------------------

const ACQUISITION_METHODS = [
  'PERMITTED_FEED',
  'RETAILER_API',
  'STRUCTURED_MERCHANT_FEED',
  'LICENSED_PROVIDER',
  'COMPLIANT_CRAWLING',
  'MANUAL_VERIFICATION',
];

/** Validate the shared operator field pair (validateOperator parity). */
function validateOperator(dto: { operator?: unknown; note?: unknown }): void {
  if (
    typeof dto.operator !== 'string' ||
    dto.operator.trim() === '' ||
    dto.operator.trim().length > 128
  ) {
    throw new ApiHttpError(400, 'operator must be a non-empty string (max 128 chars)');
  }
  if (dto.note !== undefined && typeof dto.note !== 'string') {
    throw new ApiHttpError(400, 'note must be a string when provided');
  }
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await c.req.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    throw new ApiHttpError(400, 'Request body must be JSON');
  }
}

// ---------------------------------------------------------------------------
// Governance — fail-closed reads, unwritable store
// ---------------------------------------------------------------------------

async function listGovernance(c: Context<AppEnv>): Promise<Response> {
  const merchants = await new D1MerchantRegistryRepository(c.env.DB).list();

  // Fail-closed permission state: without a governance store every
  // merchant surfaces as PENDING with zero sources (never overstated) —
  // the same shape SourceGovernanceService.checkPermission returns for a
  // merchant with no registered sources.
  return c.json({
    items: merchants.map((merchant) => ({
      merchantId: merchant.merchantId,
      name: merchant.name,
      country: merchant.country,
      feedUrl: merchant.feedUrl,
      permissionStatus: 'PENDING',
      sourceCount: 0,
      hasWarnings: false,
    })),
    total: merchants.length,
  });
}

function governanceUnavailable(): never {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message:
      'Governance mutations are unavailable: the source-governance store has no ' +
      'D1 counterpart yet (no table was ported in migrate-to-cloudflare 2.5). ' +
      'Failing closed rather than writing to a non-durable store.',
    error: 'StoreUnavailable',
  });
}

async function grantGovernance(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  validateOperator(dto);
  if (!ACQUISITION_METHODS.includes(dto.acquisitionMethod as string)) {
    throw new ApiHttpError(
      400,
      `acquisitionMethod must be one of: ${ACQUISITION_METHODS.join(', ')}`,
    );
  }
  if (typeof dto.sourceUrl !== 'string' || dto.sourceUrl.trim() === '') {
    throw new ApiHttpError(400, 'sourceUrl must be a non-empty string');
  }
  governanceUnavailable();
}

async function revokeGovernance(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  validateOperator(dto);
  if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
    throw new ApiHttpError(400, 'reason is required for revocation');
  }
  governanceUnavailable();
}

// ---------------------------------------------------------------------------
// Dataset confirmations — FX live from D1, tax reviews fail-closed
// ---------------------------------------------------------------------------

function fxService(env: AppEnv['Bindings']): {
  service: FxRateDatasetService;
  repo: D1FxRateDatasetRepositoryAdapter;
} {
  const repo = new D1FxRateDatasetRepositoryAdapter(new D1FxRateRepository(env.DB));
  return { service: new FxRateDatasetService(repo), repo };
}

async function listConfirmations(c: Context<AppEnv>): Promise<Response> {
  const { service, repo } = fxService(c.env);
  const pending = await service.listPendingDatasets();

  const fx = [];
  for (const version of pending) {
    const rates = await repo.findRatesForDataset(version.id);
    fx.push({
      id: version.id,
      versionLabel: version.versionLabel,
      status: 'PENDING_CONFIRMATION',
      sourceName: version.sourceName,
      sourceUrl: version.sourceUrl,
      referenceDate: version.referenceDate,
      effectiveFrom: version.effectiveFrom.toISOString(),
      effectiveTo: version.effectiveTo === null ? null : version.effectiveTo.toISOString(),
      rates: rates.map((rate) => ({
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: Number(rate.rate),
      })),
    });
  }

  // Tax rate-review entries: the rate-review store has no D1 counterpart
  // (2.5) — the queue reports none rather than fabricating entries.
  //
  // Consumption norms (task 4.1, wired 4.3): the pending review queue,
  // grouped by versionLabel — the FX dataset-confirmation shape mirrored
  // for the norms dataset (rows carry the citation the publish guard
  // requires, so the operator verifies provenance before confirming).
  const pendingNorms = await new D1ConsumptionNormsRepository(
    c.env.DB,
  ).findPending();
  const byNormVersion = new Map<string, typeof pendingNorms>();
  for (const norm of pendingNorms) {
    const rows = byNormVersion.get(norm.versionLabel) ?? [];
    rows.push(norm);
    byNormVersion.set(norm.versionLabel, rows);
  }
  const consumptionNorms = [...byNormVersion.entries()].map(
    ([versionLabel, rows]) => ({
      versionLabel,
      status: 'PENDING_CONFIRMATION',
      rows: rows.map((row) => ({
        id: row.id,
        drinkType: row.drinkType,
        eventProfile: row.eventProfile,
        normValuePerGuestPerHour: row.normValuePerGuestPerHour,
        sourceCitation: row.sourceCitation,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
      })),
    }),
  );

  return c.json({ fx, taxReviews: [], consumptionNorms });
}

async function confirmFx(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const { service, repo } = fxService(c.env);
  const audit = new WorkerAuditService(c.env.DB);

  // Read the predecessor BEFORE the transition — after publishing it is no
  // longer the dataset effective "now".
  let predecessor: { id: number; versionLabel: string } | null = null;
  try {
    const published = await repo.findPublishedDatasetEffectiveOn(new Date());
    predecessor = published ? { id: published.id, versionLabel: published.versionLabel } : null;
  } catch {
    // Proceed without predecessor-based invalidation (service parity).
  }

  let published: Awaited<ReturnType<FxRateDatasetService['confirmPublication']>>;
  try {
    published = await service.confirmPublication(id, dto.operator as string);
  } catch (err) {
    if (err instanceof Error && err.name === 'FxDatasetNotFoundError') {
      throw new ApiHttpError(404, `FX dataset ${id} not found`);
    }
    if (err instanceof Error && err.name === 'FxDatasetInvalidTransitionError') {
      throw new ApiHttpError(409, err.message);
    }
    throw err;
  }

  const invalidatedVersion =
    predecessor !== null && predecessor.id !== published.id ? predecessor.versionLabel : null;
  if (invalidatedVersion !== null) {
    await idempotencyInvalidateVersions(c.env, [invalidatedVersion]);
  }

  const confirmedAt = published.confirmedAt?.toISOString() ?? new Date().toISOString();
  await audit.logChange({
    entityType: 'fx_rate_dataset',
    entityId: published.versionLabel,
    action: 'confirmed',
    author: dto.operator as string,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'FX dataset publication confirmed via operator console',
    previousValue: { status: 'PENDING_CONFIRMATION', id: published.id },
    newValue: { status: 'PUBLISHED', confirmedAt, invalidatedVersion },
  });

  return c.json({
    id: published.id,
    versionLabel: published.versionLabel,
    status: 'PUBLISHED',
    confirmedAt,
    invalidatedVersion,
  });
}

/**
 * Consumption-norms confirmation (task 4.3, wiring the task-4.1
 * repository) — the FX dataset-confirmation path mirrored: read the row
 * first so unknown (404) and terminal (409, PUBLISHED is final) are
 * distinct; the blank-citation refusal is the repository's hard
 * defensive guard surfaced as 409. Deliberately NO idempotency-version
 * invalidation (unlike confirmFx): event-calc cache entries embed the
 * norms version in their key, so a publication makes old-version entries
 * unreachable rather than stale — invalidating basket/calculator entries
 * (which carry tax/FX versions) with a norms version would corrupt their
 * version checks.
 */
async function confirmConsumptionNorm(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const repo = new D1ConsumptionNormsRepository(c.env.DB);
  const audit = new WorkerAuditService(c.env.DB);

  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Consumption norm ${id} not found`);
  }

  let published: Awaited<ReturnType<D1ConsumptionNormsRepository['publish']>>;
  try {
    published = await repo.publish(id, dto.operator as string);
  } catch (err) {
    if (err instanceof MissingNormSourceCitationError) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: err.message,
        error: 'MissingNormSourceCitation',
      });
    }
    throw err;
  }
  if (published === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Consumption norm ${id} is not pending confirmation (PUBLISHED is terminal)`,
      error: 'InvalidTransition',
    });
  }

  const confirmedAt = published.confirmedAt?.toISOString() ?? new Date().toISOString();
  await audit.logChange({
    entityType: 'consumption_norm',
    entityId: published.versionLabel,
    action: 'confirmed',
    author: dto.operator as string,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Consumption norms publication confirmed via operator console',
    previousValue: { status: 'PENDING_CONFIRMATION', id: published.id },
    newValue: { status: 'PUBLISHED', confirmedAt },
  });

  return c.json({
    id: published.id,
    versionLabel: published.versionLabel,
    status: 'PUBLISHED',
    confirmedAt,
  });
}

// ---------------------------------------------------------------------------
// Ferry offers — curated affiliate slot CRUD (task 5.3, design R8)
// ---------------------------------------------------------------------------

/**
 * The console DTO's `ferryOperator` is the OFFER's operator (the ferry
 * company, R8's "operator" column); the acting console operator's
 * identity stays in the shared `operator` field (validateOperator), so
 * the two never collide in one body.
 */
const FERRY_OPERATOR_MESSAGE = 'ferryOperator must be a non-empty string (max 128 chars)';
const ROUTE_LABEL_MESSAGE = 'routeLabel must be a non-empty string (max 128 chars)';
const URL_MESSAGE = 'url must be an http(s) URL (max 2048 chars)';

const ferryOfferContentSchema = z.object({
  ferryOperator: z
    .string({
      required_error: FERRY_OPERATOR_MESSAGE,
      invalid_type_error: FERRY_OPERATOR_MESSAGE,
    })
    .min(1, FERRY_OPERATOR_MESSAGE)
    .max(128, FERRY_OPERATOR_MESSAGE),
  routeLabel: z
    .string({
      required_error: ROUTE_LABEL_MESSAGE,
      invalid_type_error: ROUTE_LABEL_MESSAGE,
    })
    .min(1, ROUTE_LABEL_MESSAGE)
    .max(128, ROUTE_LABEL_MESSAGE),
  url: z
    .string({
      required_error: URL_MESSAGE,
      invalid_type_error: URL_MESSAGE,
    })
    .min(1, URL_MESSAGE)
    .max(2048, URL_MESSAGE)
    .regex(/^https?:\/\//, URL_MESSAGE),
});

const ferryOfferUpdateSchema = ferryOfferContentSchema.partial();

/** Parse the shared operator pair (imperative check, controller parity). */
function requireOperator(dto: Record<string, unknown>): string {
  validateOperator(dto);
  return (dto.operator as string).trim();
}

/** zod-parse offer content, mapping issues to the 400 ValidationError envelope. */
function parseFerryContent<T>(schema: z.ZodType<T>, body: Record<string, unknown>): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new ApiHttpError(400, {
      statusCode: 400,
      message,
      error: 'ValidationError',
    });
  }
  return parsed.data;
}

async function listFerryOffers(c: Context<AppEnv>): Promise<Response> {
  const offers = await new D1FerryOffersRepository(c.env.DB).listAll();
  // Console-only data: unlike the public trip API this DOES carry the
  // raw url — the /ops/console guard prefix is its only door.
  return c.json({
    items: offers.map((offer) => ({
      id: offer.id,
      ferryOperator: offer.operator,
      routeLabel: offer.routeLabel,
      url: offer.url,
      status: offer.status,
      createdAt: offer.createdAt.toISOString(),
    })),
    total: offers.length,
  });
}

async function createFerryOffer(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseFerryContent(ferryOfferContentSchema, dto);

  const created = await new D1FerryOffersRepository(c.env.DB).create({
    operator: content.ferryOperator,
    routeLabel: content.routeLabel,
    url: content.url,
  });

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'ferry_offer',
    entityId: String(created.id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Ferry offer created via operator console',
    newValue: { operator: created.operator, routeLabel: created.routeLabel, status: created.status },
  });

  return c.json({
    id: created.id,
    ferryOperator: created.operator,
    routeLabel: created.routeLabel,
    status: created.status,
  });
}

async function updateFerryOffer(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseFerryContent(ferryOfferUpdateSchema, dto);

  const repo = new D1FerryOffersRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Ferry offer ${id} not found`);
  }

  let updated: Awaited<ReturnType<D1FerryOffersRepository['update']>>;
  try {
    updated = await repo.update(id, {
      operator: content.ferryOperator,
      routeLabel: content.routeLabel,
      url: content.url,
    });
  } catch (err) {
    if (err instanceof FerryOfferImmutableError) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: err.message,
        error: 'ImmutablePublishedOffer',
      });
    }
    throw err;
  }
  if (updated === null) {
    throw new ApiHttpError(404, `Ferry offer ${id} not found`);
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'ferry_offer',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason: (dto.note as string | undefined)?.trim() || 'Ferry offer updated via operator console',
    previousValue: {
      operator: existing.operator,
      routeLabel: existing.routeLabel,
      status: existing.status,
    },
    newValue: { operator: updated.operator, routeLabel: updated.routeLabel, status: updated.status },
  });

  return c.json({
    id: updated.id,
    ferryOperator: updated.operator,
    routeLabel: updated.routeLabel,
    status: updated.status,
  });
}

async function publishFerryOffer(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1FerryOffersRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Ferry offer ${id} not found`);
  }

  // PUBLISHED is terminal: null ⇒ 409 (consumption-norms confirm parity).
  const published = await repo.publish(id);
  if (published === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Ferry offer ${id} is not a draft (PUBLISHED is terminal)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'ferry_offer',
    entityId: String(id),
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Ferry offer published via operator console',
    previousValue: { status: 'DRAFT' },
    newValue: { status: 'PUBLISHED', operator: published.operator, routeLabel: published.routeLabel },
  });

  return c.json({ id: published.id, status: 'PUBLISHED' });
}

async function deleteFerryOffer(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
    throw new ApiHttpError(400, 'reason is required for deletion');
  }

  const repo = new D1FerryOffersRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Ferry offer ${id} not found`);
  }
  await repo.remove(id);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'ferry_offer',
    entityId: String(id),
    action: 'deleted',
    author: actor,
    reason: dto.reason.trim(),
    previousValue: {
      operator: existing.operator,
      routeLabel: existing.routeLabel,
      status: existing.status,
    },
  });

  return c.json({ id, deleted: true });
}

function taxReviewsUnavailable(): never {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message:
      'Tax rate-review resolution is unavailable: the rate-review store has no D1 ' +
      'counterpart yet (migrate-to-cloudflare 2.5). Failing closed rather than ' +
      'fabricating a resolution.',
    error: 'StoreUnavailable',
  });
}

async function approveTaxReview(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  validateOperator(dto);
  taxReviewsUnavailable();
}

async function rejectTaxReview(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  validateOperator(dto);
  taxReviewsUnavailable();
}

// ---------------------------------------------------------------------------
// Correction queue — fail-closed (no D1 corrections table)
// ---------------------------------------------------------------------------

function correctionsUnavailable(): never {
  throw new ApiHttpError(503, {
    statusCode: 503,
    message:
      'The correction queue is unavailable: corrections have no D1 store yet ' +
      '(migrate-to-cloudflare 2.5). Failing closed rather than serving a queue ' +
      'that cannot persist.',
    error: 'StoreUnavailable',
  });
}

const createCorrectionSchema = z.object({
  targetType: z.enum(['calculation', 'data_point'], {
    errorMap: () => ({ message: 'targetType must be "calculation" or "data_point"' }),
  }),
  targetId: z
    .number({
      required_error: 'targetId must be a positive integer',
      invalid_type_error: 'targetId must be a positive integer',
    })
    .int('targetId must be a positive integer')
    .positive('targetId must be a positive integer'),
  reason: z
    .string({
      required_error: 'reason must be a non-empty string',
      invalid_type_error: 'reason must be a non-empty string',
    })
    .min(1, 'reason must be a non-empty string'),
  operator: z
    .string({
      required_error: 'operator must be a non-empty string (max 128 chars)',
      invalid_type_error: 'operator must be a non-empty string (max 128 chars)',
    })
    .min(1, 'operator must be a non-empty string (max 128 chars)')
    .max(128, 'operator must be a non-empty string (max 128 chars)'),
});

async function listCorrections(c: Context<AppEnv>): Promise<Response> {
  void c;
  correctionsUnavailable();
}

async function openCorrection(c: Context<AppEnv>): Promise<Response> {
  const parsed = createCorrectionSchema.safeParse(await readBody(c));
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join('; ');
    throw new ApiHttpError(400, message);
  }
  correctionsUnavailable();
}

async function resolveCorrection(c: Context<AppEnv>): Promise<Response> {
  parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);
  correctionsUnavailable();
}

// ---------------------------------------------------------------------------
// Audit trail — real D1 audit_events reads
// ---------------------------------------------------------------------------

/** Hard cap on the requested trail length. */
const MAX_LIMIT = 100;
/** Default trail length. */
const DEFAULT_LIMIT = 25;

async function recentAudit(c: Context<AppEnv>): Promise<Response> {
  const raw = c.req.query('limit');
  const parsed = raw === undefined ? undefined : Number.parseInt(raw, 10);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isInteger(parsed) ? (parsed as number) : DEFAULT_LIMIT),
  );

  const entries = await new WorkerAuditService(c.env.DB).queryChanges({ limit });
  return c.json({
    items: entries.map((entry) => ({
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      author: entry.author,
      reason: entry.reason,
      timestamp: entry.timestamp,
    })),
    total: entries.length,
  });
}

// ---------------------------------------------------------------------------
// Registration (guards pre-registered on the /ops/console/* prefix)
// ---------------------------------------------------------------------------

/** Register the ops console handlers behind the 3.2 guard prefix. */
export function registerOpsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.get('/ops/console/governance', listGovernance);
  app.post('/ops/console/governance/:merchantId/grant', grantGovernance);
  app.post('/ops/console/governance/:merchantId/revoke', revokeGovernance);

  app.get('/ops/console/confirmations', listConfirmations);
  app.post('/ops/console/confirmations/fx/:id/confirm', confirmFx);
  app.post(
    '/ops/console/confirmations/consumption-norms/:id/confirm',
    confirmConsumptionNorm,
  );
  app.post('/ops/console/confirmations/tax/:id/approve', approveTaxReview);
  app.post('/ops/console/confirmations/tax/:id/reject', rejectTaxReview);

  app.get('/ops/console/corrections', listCorrections);
  app.post('/ops/console/corrections', openCorrection);
  app.post('/ops/console/corrections/:id/resolve', resolveCorrection);

  // Ferry offers (task 5.3, R8) — audited CRUD over the curated
  // affiliate slot. POST-style mutations match the console's confirm
  // path; the DELETE is POST :id/delete so the acting operator + reason
  // travel in the body like every other console mutation.
  app.get('/ops/console/ferry-offers', listFerryOffers);
  app.post('/ops/console/ferry-offers', createFerryOffer);
  app.post('/ops/console/ferry-offers/:id', updateFerryOffer);
  app.post('/ops/console/ferry-offers/:id/publish', publishFerryOffer);
  app.post('/ops/console/ferry-offers/:id/delete', deleteFerryOffer);

  app.get('/ops/console/audit', recentAudit);
  return app;
}

export type { D1DatabaseLike };

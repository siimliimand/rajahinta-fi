/**
 * Operator-console API port (task 3.8) — Hono re-host of the four ops
 * console controllers (packages/application-api/src/ops/): governance
 * grants, dataset confirmations (tax rate-reviews and consumption norms),
 * the correction queue, and the audit trail. Task 5.3 (change product-roadmap-phases-1-4)
 * adds the ferry-offer CRUD — the curated affiliate slot's audited
 * management surface (design R8). Task 6.1 adds the producer-link CRUD
 * — the curated sibling-product evidence surface (design R9), exact
 * normalized-key matching only (spec: producer-matching).
 *
 * guard composition (3.2 route-coverage map): the /ops/console/* prefix
 * already carries opsAccess() — deny BEFORE any operational data.
 * Operator identity for the audit trail travels in each mutating request
 * body (`operator`), as in Nest.
 *
 * Task 7.1 (change product-roadmap-phases-1-4) adds the curated-entry
 * CRUD — the public curated lists' audited management surface (design
 * R10, spec: curated-lists). Unlike the ferry/producer lifecycles,
 * PUBLISHED is not terminal: the spec mandates entries are created,
 * updated, AND unpublished through this console so content changes
 * never require deploys.
 *
 * EVERY mutating action writes an append-only D1 `audit_events` row via
 * the task-2.5 D1AuditEventRepository (WorkerAuditService).
 *
 * ## Fail-closed stores (documented scope note, task 3.8)
 *
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
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import {
  D1ConsumptionNormsRepository,
  MissingNormSourceCitationError,
} from '../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import {
  D1FerryOffersRepository,
  FerryOfferImmutableError,
} from '../../../../packages/data-platform/src/repositories/d1/ferry-offers.repository';
import {
  D1ProducerLinksRepository,
  ProducerLinkImmutableError,
} from '../../../../packages/data-platform/src/repositories/d1/producer-links.repository';
import {
  D1CuratedEntriesRepository,
  evidenceLinksSchema,
} from '../../../../packages/data-platform/src/repositories/d1/curated-entries.repository';
import { D1BlogPostRepository } from '../../../../packages/data-platform/src/repositories/d1/blog-post.repository';
import { D1ShopReportRepository } from '../../../../packages/data-platform/src/repositories/d1/shop-report.repository';
import { D1BlacklistRepository } from '../../../../packages/data-platform/src/repositories/d1/blacklist.repository';
import type { ShopReportRecord } from '../../../../packages/data-platform/src/abstracts';
import type { BlacklistEntryRecord } from '../../../../packages/data-platform/src/abstracts';
import {
  evaluatePublicationStandard,
  normalizeMerchantIdentity,
} from '../../../../packages/core-domain/src/blacklist/blacklist';
import {
  InvalidBlacklistReportError,
  MIN_INDEPENDENT_NON_DELIVERY_REPORTS,
} from '../../../../packages/core-domain/src/blacklist/blacklist.types';
import {
  notifyNewsletterSubscribers,
} from '../services/newsletter.service';
import { createLogger } from '../logger';
import { passesContentPolicy } from '../../../../packages/core-domain/src/content/content-lint';
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
// Dataset confirmations — tax reviews fail-closed
// ---------------------------------------------------------------------------

async function listConfirmations(c: Context<AppEnv>): Promise<Response> {
  // Tax rate-review entries: the rate-review store has no D1 counterpart
  // (2.5) — the queue reports none rather than fabricating entries.
  //
  // Consumption norms (task 4.1, wired 4.3): the pending review queue,
  // grouped by versionLabel — rows carry the citation the publish guard
  // requires, so the operator verifies provenance before confirming.
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

  return c.json({ taxReviews: [], consumptionNorms });
}

/**
 * Consumption-norms confirmation (task 4.3, wiring the task-4.1
 * repository) — read the row first so unknown (404) and terminal (409,
 * PUBLISHED is final) are distinct; the blank-citation refusal is the
 * repository's hard defensive guard surfaced as 409. Deliberately NO
 * idempotency-version invalidation: event-calc cache entries embed the
 * norms version in their key, so a publication makes old-version entries
 * unreachable rather than stale — invalidating basket/calculator entries
 * with a norms version would corrupt their version checks.
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

/** zod-parse curated-content DTOs, mapping issues to the 400 ValidationError envelope. */
function parseConsoleContent<T>(schema: z.ZodType<T>, body: Record<string, unknown>): T {
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
  const content = parseConsoleContent(ferryOfferContentSchema, dto);

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
  const content = parseConsoleContent(ferryOfferUpdateSchema, dto);

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

// ---------------------------------------------------------------------------
// Producer links — curated sibling-product evidence CRUD (task 6.1, R9)
// ---------------------------------------------------------------------------

/**
 * Every response and audit payload carries the COMPLETE evidence
 * (producer key, manufacturer, source URL, reviewer, reviewedAt) —
 * R9 makes an unevidenced row unrepresentable at the schema level, so
 * the console never has a partial-evidence state to hide. The matching
 * path behind these rows is an exact normalized-key lookup; no
 * scoring/similarity field exists in the DTO surface either.
 */
const PRODUCER_KEY_MESSAGE = 'producerKey must be a non-empty string (max 256 chars)';
const MANUFACTURER_MESSAGE = 'manufacturer must be a non-empty string (max 256 chars)';
const LINK_SOURCE_URL_MESSAGE = 'sourceUrl must be an http(s) URL (max 2048 chars)';
const REVIEWER_MESSAGE = 'reviewer must be a non-empty string (max 128 chars)';
const REVIEWED_AT_MESSAGE = 'reviewedAt must be an ISO-8601 timestamp';
const LINK_PRODUCT_ID_MESSAGE = 'must be a positive integer';

const producerLinkContentSchema = z.object({
  alkoProductId: z
    .number({
      required_error: `alkoProductId ${LINK_PRODUCT_ID_MESSAGE}`,
      invalid_type_error: `alkoProductId ${LINK_PRODUCT_ID_MESSAGE}`,
    })
    .int(`alkoProductId ${LINK_PRODUCT_ID_MESSAGE}`)
    .positive(`alkoProductId ${LINK_PRODUCT_ID_MESSAGE}`),
  siblingProductId: z
    .number({
      required_error: `siblingProductId ${LINK_PRODUCT_ID_MESSAGE}`,
      invalid_type_error: `siblingProductId ${LINK_PRODUCT_ID_MESSAGE}`,
    })
    .int(`siblingProductId ${LINK_PRODUCT_ID_MESSAGE}`)
    .positive(`siblingProductId ${LINK_PRODUCT_ID_MESSAGE}`),
  producerKey: z
    .string({
      required_error: PRODUCER_KEY_MESSAGE,
      invalid_type_error: PRODUCER_KEY_MESSAGE,
    })
    .min(1, PRODUCER_KEY_MESSAGE)
    .max(256, PRODUCER_KEY_MESSAGE),
  manufacturer: z
    .string({
      required_error: MANUFACTURER_MESSAGE,
      invalid_type_error: MANUFACTURER_MESSAGE,
    })
    .min(1, MANUFACTURER_MESSAGE)
    .max(256, MANUFACTURER_MESSAGE),
  sourceUrl: z
    .string({
      required_error: LINK_SOURCE_URL_MESSAGE,
      invalid_type_error: LINK_SOURCE_URL_MESSAGE,
    })
    .min(1, LINK_SOURCE_URL_MESSAGE)
    .max(2048, LINK_SOURCE_URL_MESSAGE)
    .regex(/^https?:\/\//, LINK_SOURCE_URL_MESSAGE),
  reviewer: z
    .string({
      required_error: REVIEWER_MESSAGE,
      invalid_type_error: REVIEWER_MESSAGE,
    })
    .min(1, REVIEWER_MESSAGE)
    .max(128, REVIEWER_MESSAGE),
  reviewedAt: z
    .string({
      required_error: REVIEWED_AT_MESSAGE,
      invalid_type_error: REVIEWED_AT_MESSAGE,
    })
    .min(1, REVIEWED_AT_MESSAGE)
    .refine((value) => !Number.isNaN(Date.parse(value)), REVIEWED_AT_MESSAGE),
});

const producerLinkUpdateSchema = producerLinkContentSchema.partial();

/** The content fields shared by every producer-link audit payload. */
function producerLinkEvidence(link: {
  alkoProductId: number;
  siblingProductId: number;
  producerKey: string;
  manufacturer: string;
  sourceUrl: string;
  reviewer: string;
  status: string;
}): Record<string, unknown> {
  return {
    alkoProductId: link.alkoProductId,
    siblingProductId: link.siblingProductId,
    producerKey: link.producerKey,
    manufacturer: link.manufacturer,
    sourceUrl: link.sourceUrl,
    reviewer: link.reviewer,
    status: link.status,
  };
}

/** A link pairing a product with itself is a curation bug (schema CHECK too). */
function requireDistinctProducts(alkoProductId: number, siblingProductId: number): void {
  if (alkoProductId === siblingProductId) {
    throw new ApiHttpError(
      400,
      'alkoProductId and siblingProductId must differ (a product is its own trivial sibling)',
    );
  }
}

async function listProducerLinks(c: Context<AppEnv>): Promise<Response> {
  const links = await new D1ProducerLinksRepository(c.env.DB).listAll();
  return c.json({
    items: links.map((link) => ({
      id: link.id,
      alkoProductId: link.alkoProductId,
      siblingProductId: link.siblingProductId,
      producerKey: link.producerKey,
      manufacturer: link.manufacturer,
      sourceUrl: link.sourceUrl,
      reviewer: link.reviewer,
      reviewedAt: link.reviewedAt.toISOString(),
      status: link.status,
      createdAt: link.createdAt.toISOString(),
    })),
    total: links.length,
  });
}

async function createProducerLink(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(producerLinkContentSchema, dto);
  requireDistinctProducts(content.alkoProductId, content.siblingProductId);

  const created = await new D1ProducerLinksRepository(c.env.DB).create({
    alkoProductId: content.alkoProductId,
    siblingProductId: content.siblingProductId,
    // The repository normalizes the key before persistence — the
    // stored (and echoed) form is always normalized.
    producerKey: content.producerKey,
    manufacturer: content.manufacturer,
    sourceUrl: content.sourceUrl,
    reviewer: content.reviewer,
    reviewedAt: content.reviewedAt,
  });

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'producer_link',
    entityId: String(created.id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Producer link created via operator console',
    newValue: producerLinkEvidence(created),
  });

  return c.json({
    id: created.id,
    alkoProductId: created.alkoProductId,
    siblingProductId: created.siblingProductId,
    producerKey: created.producerKey,
    status: created.status,
  });
}

async function updateProducerLink(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(producerLinkUpdateSchema, dto);

  const repo = new D1ProducerLinksRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Producer link ${id} not found`);
  }

  // Self-link check on the MERGED values — a patch pairing the row
  // with itself is rejected before the repository (and its CHECK) see it.
  requireDistinctProducts(
    content.alkoProductId ?? existing.alkoProductId,
    content.siblingProductId ?? existing.siblingProductId,
  );

  let updated: Awaited<ReturnType<D1ProducerLinksRepository['update']>>;
  try {
    updated = await repo.update(id, content);
  } catch (err) {
    if (err instanceof ProducerLinkImmutableError) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: err.message,
        error: 'ImmutablePublishedLink',
      });
    }
    throw err;
  }
  if (updated === null) {
    throw new ApiHttpError(404, `Producer link ${id} not found`);
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'producer_link',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason: (dto.note as string | undefined)?.trim() || 'Producer link updated via operator console',
    previousValue: producerLinkEvidence(existing),
    newValue: producerLinkEvidence(updated),
  });

  return c.json({
    id: updated.id,
    alkoProductId: updated.alkoProductId,
    siblingProductId: updated.siblingProductId,
    producerKey: updated.producerKey,
    status: updated.status,
  });
}

async function publishProducerLink(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1ProducerLinksRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Producer link ${id} not found`);
  }

  // PUBLISHED is terminal: null ⇒ 409 (ferry-offer parity).
  const published = await repo.publish(id);
  if (published === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Producer link ${id} is not a draft (PUBLISHED is terminal)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'producer_link',
    entityId: String(id),
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Producer link published via operator console',
    previousValue: { status: 'DRAFT' },
    newValue: producerLinkEvidence(published),
  });

  return c.json({ id: published.id, status: 'PUBLISHED' });
}

async function deleteProducerLink(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
    throw new ApiHttpError(400, 'reason is required for deletion');
  }

  const repo = new D1ProducerLinksRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Producer link ${id} not found`);
  }
  await repo.remove(id);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'producer_link',
    entityId: String(id),
    action: 'deleted',
    author: actor,
    reason: dto.reason.trim(),
    previousValue: producerLinkEvidence(existing),
  });

  return c.json({ id, deleted: true });
}

// ---------------------------------------------------------------------------
// Curated list entries — operator-managed list content CRUD (task 7.1, R10)
// ---------------------------------------------------------------------------

/**
 * Every response and audit payload carries the COMPLETE editorial
 * record (slug, target, rationale, evidence links, reviewer, status)
 * — R10 makes an unevidenced entry unrepresentable at the schema
 * level, so the console never has a partial-evidence state to hide.
 * evidenceLinks is parsed by the REPOSITORY's exported zod schema
 * (single source of truth with the storage guard).
 */
const SLUG_MESSAGE =
  'listSlug must be a kebab-case slug (lowercase letters, digits, hyphens; max 128 chars)';
const ENTRY_RATIONALE_MESSAGE =
  'rationale must be a non-empty string (max 2000 chars)';
const ENTRY_REVIEWER_MESSAGE = 'reviewer must be a non-empty string (max 128 chars)';
const EXTERNAL_REF_MESSAGE = 'externalRef must be a non-empty string (max 512 chars)';
const ENTRY_PRODUCT_ID_MESSAGE = 'must be a positive integer';

const curatedEntryBaseSchema = z.object({
  listSlug: z
    .string({
      required_error: SLUG_MESSAGE,
      invalid_type_error: SLUG_MESSAGE,
    })
    .min(1, SLUG_MESSAGE)
    .max(128, SLUG_MESSAGE)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, SLUG_MESSAGE),
  productId: z
    .number({
      required_error: `productId ${ENTRY_PRODUCT_ID_MESSAGE}`,
      invalid_type_error: `productId ${ENTRY_PRODUCT_ID_MESSAGE}`,
    })
    .int(`productId ${ENTRY_PRODUCT_ID_MESSAGE}`)
    .positive(`productId ${ENTRY_PRODUCT_ID_MESSAGE}`)
    .optional(),
  externalRef: z
    .string({
      required_error: EXTERNAL_REF_MESSAGE,
      invalid_type_error: EXTERNAL_REF_MESSAGE,
    })
    .min(1, EXTERNAL_REF_MESSAGE)
    .max(512, EXTERNAL_REF_MESSAGE)
    .optional(),
  rationale: z
    .string({
      required_error: ENTRY_RATIONALE_MESSAGE,
      invalid_type_error: ENTRY_RATIONALE_MESSAGE,
    })
    .min(1, ENTRY_RATIONALE_MESSAGE)
    .max(2000, ENTRY_RATIONALE_MESSAGE),
  evidenceLinks: evidenceLinksSchema,
  reviewer: z
    .string({
      required_error: ENTRY_REVIEWER_MESSAGE,
      invalid_type_error: ENTRY_REVIEWER_MESSAGE,
    })
    .min(1, ENTRY_REVIEWER_MESSAGE)
    .max(128, ENTRY_REVIEWER_MESSAGE),
});

const curatedEntryContentSchema = curatedEntryBaseSchema.refine(
  (entry) => (entry.productId === undefined) !== (entry.externalRef === undefined),
  { message: 'exactly one of productId or externalRef is required' },
);

const curatedEntryUpdateSchema = curatedEntryBaseSchema.partial().refine(
  // Both targets in one patch is always ambiguous; one alone is
  // resolved against the stored row in the handler (merged check).
  (entry) => !(entry.productId !== undefined && entry.externalRef !== undefined),
  { message: 'exactly one of productId or externalRef is required' },
);

/** The content fields shared by every curated-entry audit payload. */
function curatedEntryEvidence(entry: {
  listSlug: string;
  productId: number | null;
  externalRef: string | null;
  rationale: string;
  evidenceLinks: readonly { label: string; url: string }[];
  reviewer: string;
  status: string;
}): Record<string, unknown> {
  return {
    listSlug: entry.listSlug,
    productId: entry.productId,
    externalRef: entry.externalRef,
    rationale: entry.rationale,
    evidenceLinks: entry.evidenceLinks,
    reviewer: entry.reviewer,
    status: entry.status,
  };
}

/** The console response body — the COMPLETE editorial record. */
function curatedEntryBody(entry: {
  id: number;
  listSlug: string;
  productId: number | null;
  externalRef: string | null;
  rationale: string;
  evidenceLinks: readonly { label: string; url: string }[];
  reviewer: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entry.id,
    listSlug: entry.listSlug,
    productId: entry.productId,
    externalRef: entry.externalRef,
    rationale: entry.rationale,
    evidenceLinks: entry.evidenceLinks,
    reviewer: entry.reviewer,
    status: entry.status,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

async function listCuratedEntries(c: Context<AppEnv>): Promise<Response> {
  const repo = new D1CuratedEntriesRepository(c.env.DB);
  const slug = c.req.query('slug');
  const entries = slug !== undefined && slug !== ''
    ? await repo.listBySlug(slug)
    : await repo.listAll();
  return c.json({
    items: entries.map(curatedEntryBody),
    total: entries.length,
  });
}

async function createCuratedEntry(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(curatedEntryContentSchema, dto);

  const created = await new D1CuratedEntriesRepository(c.env.DB).create({
    listSlug: content.listSlug,
    // The repository normalizes the slug before persistence — the
    // stored (and echoed) form is always normalized.
    productId: content.productId,
    externalRef: content.externalRef,
    rationale: content.rationale,
    evidenceLinks: content.evidenceLinks,
    reviewer: content.reviewer,
  });

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'curated_entry',
    entityId: String(created.id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Curated entry created via operator console',
    newValue: curatedEntryEvidence(created),
  });

  return c.json({
    id: created.id,
    listSlug: created.listSlug,
    status: created.status,
  });
}

async function updateCuratedEntry(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(curatedEntryUpdateSchema, dto);

  const repo = new D1CuratedEntriesRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Curated entry ${id} not found`);
  }

  // Edits are allowed in ANY status (including PUBLISHED) — the spec's
  // no-deploy content-update requirement; the audit below is what
  // keeps the published history explained. A one-sided target patch
  // IS the target swap (repository contract); both-sides patches were
  // rejected by the schema above.
  const updated = await repo.update(id, content);
  if (updated === null) {
    throw new ApiHttpError(404, `Curated entry ${id} not found`);
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'curated_entry',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason: (dto.note as string | undefined)?.trim() || 'Curated entry updated via operator console',
    previousValue: curatedEntryEvidence(existing),
    newValue: curatedEntryEvidence(updated),
  });

  return c.json(curatedEntryBody(updated));
}

async function publishCuratedEntry(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1CuratedEntriesRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Curated entry ${id} not found`);
  }

  // Only a DRAFT flips; already-published is a 409 (ferry parity).
  const published = await repo.publish(id);
  if (published === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Curated entry ${id} is not a draft`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'curated_entry',
    entityId: String(id),
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Curated entry published via operator console',
    previousValue: { status: 'DRAFT' },
    newValue: curatedEntryEvidence(published),
  });

  return c.json({ id: published.id, status: published.status });
}

async function unpublishCuratedEntry(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1CuratedEntriesRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Curated entry ${id} not found`);
  }

  // Only a PUBLISHED row flips back (spec "created, updated, and
  // unpublished"); already-draft is a 409 (publish parity).
  const unpublished = await repo.unpublish(id);
  if (unpublished === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Curated entry ${id} is not published`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'curated_entry',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Curated entry unpublished via operator console',
    previousValue: curatedEntryEvidence(existing),
    newValue: curatedEntryEvidence(unpublished),
  });

  return c.json({ id: unpublished.id, status: unpublished.status });
}

async function deleteCuratedEntry(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
    throw new ApiHttpError(400, 'reason is required for deletion');
  }

  const repo = new D1CuratedEntriesRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Curated entry ${id} not found`);
  }
  await repo.remove(id);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'curated_entry',
    entityId: String(id),
    action: 'deleted',
    author: actor,
    reason: dto.reason.trim(),
    previousValue: curatedEntryEvidence(existing),
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
// Blog posts — the human publication gate (task 5.1, change
// trust-and-reach-roadmap): the rate-confirmation hook lands DRAFTs; only
// this console action makes one public, and only when the body passes the
// content-policy lint (spec content-publication).
// ---------------------------------------------------------------------------

async function listBlogPosts(c: Context<AppEnv>): Promise<Response> {
  const posts = await new D1BlogPostRepository(c.env.DB).listByLocale(
    // The console manages the launch locales as one list.
    'fi',
  );
  const en = await new D1BlogPostRepository(c.env.DB).listByLocale('en');
  const items = [...posts, ...en].map((post) => ({
    id: post.id,
    slug: post.slug,
    locale: post.locale,
    title: post.title,
    status: post.status,
    rateDatasetVersion: post.rateDatasetVersion,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
  }));
  return c.json({ items, total: items.length });
}

async function publishBlogPost(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1BlogPostRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Blog post ${id} not found`);
  }

  // The lint gates the TRANSITION (spec: bodies pass the content-policy
  // lint before publication) — a violating draft stays a draft.
  if (!passesContentPolicy(existing.bodyMarkdown)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'Post body violates the content policy — edit the draft before publication',
      error: 'ContentPolicyViolation',
    });
  }

  // DRAFT → PUBLISHED, exactly once (null ⇒ 409, terminal-state parity).
  const published = await repo.publish(id);
  if (published === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Blog post ${id} is not a draft (PUBLISHED is terminal)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blog_post',
    entityId: String(id),
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Blog post published via operator console (${published.slug}/${published.locale})`,
    previousValue: { status: existing.status, slug: existing.slug, locale: existing.locale },
    newValue: {
      status: published.status,
      publishedAt: published.publishedAt?.toISOString() ?? null,
    },
  });

  return c.json({
    id: published.id,
    slug: published.slug,
    locale: published.locale,
    status: published.status,
    publishedAt: published.publishedAt?.toISOString() ?? null,
  });
}

// ---------------------------------------------------------------------------
// Shop-report moderation + blacklist publication (task 2.3, change
// trust-and-reach-roadmap; spec merchant-blacklist)
// ---------------------------------------------------------------------------

/** The review-queue row — OPEN reports WITH their evidence (ops-only). */
function reportQueueItem(report: ShopReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    merchantDomain: report.merchantDomain,
    merchantNameNormalized: report.merchantNameNormalized,
    orderReference: report.orderReference,
    correspondenceSummary: report.correspondenceSummary,
    reporterAccountId: report.reporterAccountId,
    status: report.status,
    linkedEntryId: report.linkedEntryId,
    createdAt: report.createdAt.toISOString(),
  };
}

/** The console's blacklist-entry row (appeal facts included). */
function blacklistEntryBody(entry: BlacklistEntryRecord): Record<string, unknown> {
  return {
    id: entry.id,
    merchantDomain: entry.merchantDomain,
    merchantNameNormalized: entry.merchantNameNormalized,
    standardMet: entry.standardMet,
    publishedAt: entry.publishedAt.toISOString(),
    publishedBy: entry.publishedBy,
    status: entry.status,
    appealedAt: entry.appealedAt?.toISOString() ?? null,
    appealReason: entry.appealReason,
  };
}

/** Review queue: the OPEN reports, oldest first (repository order). */
async function listReportQueue(c: Context<AppEnv>): Promise<Response> {
  const reports = await new D1ShopReportRepository(c.env.DB).findOpen();
  return c.json({ items: reports.map(reportQueueItem), total: reports.length });
}

const reportLinkSchema = z.object({
  entryId: z.number({
    required_error: 'entryId is required',
    invalid_type_error: 'entryId must be a positive integer',
  }).int().positive('entryId must be a positive integer'),
});

/** Link an OPEN report to an EXISTING published entry (late evidence). */
async function linkReport(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(reportLinkSchema, dto);

  const reports = new D1ShopReportRepository(c.env.DB);
  const report = await reports.findById(id);
  if (report === null) {
    throw new ApiHttpError(404, `Shop report ${id} not found`);
  }
  const entry = await new D1BlacklistRepository(c.env.DB).findById(content.entryId);
  if (entry === null) {
    throw new ApiHttpError(404, `Blacklist entry ${content.entryId} not found`);
  }
  // A report can only back an entry for the SAME merchant identity.
  if (
    entry.merchantDomain !== report.merchantDomain ||
    entry.merchantNameNormalized !== report.merchantNameNormalized
  ) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'report and entry belong to different merchant identities',
      error: 'IdentityMismatch',
    });
  }

  // OPEN → LINKED, terminal (guarded UPDATE; not-OPEN ⇒ 409).
  const linked = await reports.linkToEntry(id, content.entryId);
  if (linked === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Shop report ${id} is not OPEN (only an OPEN report can be linked)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'shop_report',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Report linked to blacklist entry ${content.entryId} via operator console`,
    previousValue: { status: report.status, linkedEntryId: report.linkedEntryId },
    newValue: { status: linked.status, linkedEntryId: linked.linkedEntryId },
  });

  return c.json({
    id: linked.id,
    status: linked.status,
    linkedEntryId: linked.linkedEntryId,
  });
}

/** Reject an OPEN report — the evidence did not survive review (terminal). */
async function rejectReport(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const reports = new D1ShopReportRepository(c.env.DB);
  const report = await reports.findById(id);
  if (report === null) {
    throw new ApiHttpError(404, `Shop report ${id} not found`);
  }

  const rejected = await reports.reject(id);
  if (rejected === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Shop report ${id} is not OPEN (only an OPEN report can be rejected)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'shop_report',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Report rejected via operator console',
    previousValue: { status: report.status },
    newValue: { status: rejected.status },
  });

  return c.json({ id: rejected.id, status: rejected.status });
}

/** Every entry regardless of status — the console's blacklist overview. */
async function listBlacklistEntries(c: Context<AppEnv>): Promise<Response> {
  const entries = await new D1BlacklistRepository(c.env.DB).list();
  return c.json({
    items: entries.map(blacklistEntryBody),
    total: entries.length,
  });
}

/** The appeal inbox: exactly the REOPENED entries awaiting re-review. */
async function listAppeals(c: Context<AppEnv>): Promise<Response> {
  const entries = await new D1BlacklistRepository(c.env.DB).list();
  const appeals = entries.filter((entry) => entry.status === 'REOPENED');
  return c.json({
    items: appeals.map(blacklistEntryBody),
    total: appeals.length,
  });
}

const publishSchema = z.object({
  merchantDomain: z
    .string({ required_error: 'merchantDomain is required', invalid_type_error: 'merchantDomain is required' })
    .min(1, 'merchantDomain is required'),
  merchantName: z
    .string({ required_error: 'merchantName is required', invalid_type_error: 'merchantName is required' })
    .min(1, 'merchantName is required'),
  confirmedReportIds: z.array(
    z.number({
      required_error: 'confirmedReportIds is required',
      invalid_type_error: 'confirmedReportIds must be an array of report ids',
    }).int().positive('confirmedReportIds must be an array of report ids'),
    { required_error: 'confirmedReportIds is required' },
  ),
  businessRegistrationConfirmed: z.boolean({
    invalid_type_error: 'businessRegistrationConfirmed must be a boolean when provided',
  }).optional(),
});

/**
 * Publish a blacklist entry — the manual action behind the published
 * standard. The standard is enforced SERVER-SIDE from the stored rows:
 * the operator names the merchant and the reports they confirm as
 * non-delivery; the corpus handed to core-domain's
 * `evaluatePublicationStandard` is recomputed from the database (the
 * confirmed OPEN reports plus every LINKED report of the identity —
 * earlier moderation decisions), so a below-threshold publication is
 * rejected with NO entry created (spec scenario "Standard not met").
 * Independence is exact reporter-account distinctness, decided by the
 * stored reporter ids, never by the request.
 */
async function publishBlacklistEntry(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(publishSchema, dto);

  // The identity normalizes here exactly as reports did at submission —
  // an unusable domain/name cannot form an entry.
  let identity: ReturnType<typeof normalizeMerchantIdentity>;
  try {
    identity = normalizeMerchantIdentity(content.merchantDomain, content.merchantName);
  } catch (err) {
    if (err instanceof InvalidBlacklistReportError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: err.reason,
      });
    }
    throw err;
  }

  const reports = new D1ShopReportRepository(c.env.DB);
  const entries = new D1BlacklistRepository(c.env.DB);
  const identityReports = await reports.findByMerchantIdentity(identity);

  // Every confirmed id must be a real report of THIS identity.
  const byId = new Map(identityReports.map((report) => [report.id, report]));
  for (const reportId of content.confirmedReportIds) {
    if (!byId.has(reportId)) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: `report ${reportId} does not belong to this merchant identity`,
        error: 'UnknownReport',
      });
    }
  }
  const confirmedIds = new Set(content.confirmedReportIds);

  // Evidence corpus, recomputed from stored rows: confirmed OPEN
  // reports + every LINKED report (already-confirmed evidence).
  const corpus = identityReports
    .filter(
      (report) =>
        report.status === 'LINKED' ||
        (report.status === 'OPEN' && confirmedIds.has(report.id)),
    )
    .map((report) => ({
      reporterAccountId: String(report.reporterAccountId),
      confirmedNonDelivery: true,
    }));

  const standard = evaluatePublicationStandard({
    nonDeliveryReports: corpus,
    businessRegistration:
      content.businessRegistrationConfirmed === true
        ? { confirmedInvalid: true }
        : null,
  });
  if (!standard.met) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message:
        `published standard not met (${standard.reason}; ` +
        `${standard.independentConfirmedCount} independent confirmed ` +
        `non-delivery reports of ${MIN_INDEPENDENT_NON_DELIVERY_REPORTS} required)` +
        (content.businessRegistrationConfirmed === true
          ? ''
          : '; no confirmed invalid business registration'),
      error: 'StandardNotMet',
    });
  }

  const entry = await entries.publish({
    merchantIdentity: identity,
    standardMet: standard.basis,
    publishedBy: actor,
  });

  // The confirmed OPEN reports become the entry's evidence (terminal).
  const linkedReportIds: number[] = [];
  for (const reportId of confirmedIds) {
    const linked = await reports.linkToEntry(reportId, entry.id);
    if (linked !== null) {
      linkedReportIds.push(reportId);
    }
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blacklist_entry',
    entityId: String(entry.id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Blacklist entry published via operator console (basis ${standard.basis})`,
    newValue: {
      merchantDomain: entry.merchantDomain,
      merchantNameNormalized: entry.merchantNameNormalized,
      standardMet: entry.standardMet,
      linkedReportIds,
    },
  });

  return c.json(
    { ...blacklistEntryBody(entry), linkedReportIds },
    201,
  );
}

const appealSchema = z.object({
  appealReason: z
    .string({ required_error: 'appealReason is required', invalid_type_error: 'appealReason is required' })
    .min(1, 'appealReason is required'),
});

/**
 * Record an appeal against a PUBLISHED entry (the merchant disputes
 * out-of-band; the console records it): PUBLISHED → REOPENED, which
 * removes the entry from public display immediately (the repository's
 * display join filters to exactly-PUBLISHED).
 */
async function recordAppeal(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(appealSchema, dto);

  const entries = new D1BlacklistRepository(c.env.DB);
  const entry = await entries.findById(id);
  if (entry === null) {
    throw new ApiHttpError(404, `Blacklist entry ${id} not found`);
  }

  const reopened = await entries.appeal(id, {
    appealedAt: new Date(),
    appealReason: content.appealReason.trim(),
  });
  if (reopened === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Blacklist entry ${id} is not PUBLISHED (only a PUBLISHED entry can be reopened by an appeal)`,
      error: 'InvalidTransition',
    });
  }

  // The appeal reason lives on the row; the audit carries the decision
  // facts (status change + that an appeal was recorded), not the
  // merchant's text.
  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blacklist_entry',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Appeal recorded via operator console — entry reopened for re-review',
    previousValue: { status: entry.status },
    newValue: { status: reopened.status, appealRecorded: true },
  });

  return c.json(blacklistEntryBody(reopened));
}

const appealResolutionSchema = z.object({
  resolution: z.enum(['REPUBLISH', 'REJECT'], {
    required_error: 'resolution must be REPUBLISH or REJECT',
    invalid_type_error: 'resolution must be REPUBLISH or REJECT',
    message: 'resolution must be REPUBLISH or REJECT',
  }),
});

/**
 * Resolve a REOPENED entry — REPUBLISH returns it to PUBLISHED (appeal
 * denied), REJECT ends it (appeal upheld, terminal). Both are audited
 * operator decisions.
 */
async function resolveAppeal(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(appealResolutionSchema, dto);

  const entries = new D1BlacklistRepository(c.env.DB);
  const entry = await entries.findById(id);
  if (entry === null) {
    throw new ApiHttpError(404, `Blacklist entry ${id} not found`);
  }

  const resolved =
    content.resolution === 'REPUBLISH'
      ? await entries.resolveRepublish(id)
      : await entries.resolveReject(id);
  if (resolved === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Blacklist entry ${id} is not REOPENED (only a REOPENED entry can be resolved)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blacklist_entry',
    entityId: String(id),
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Appeal ${content.resolution === 'REPUBLISH' ? 'denied — entry republished' : 'upheld — entry rejected'} via operator console`,
    previousValue: { status: entry.status },
    newValue: { status: resolved.status },
  });

  return c.json(blacklistEntryBody(resolved));
}

// ---------------------------------------------------------------------------
// Newsletter broadcast (task 5.3, change trust-and-reach-roadmap;
// design D4, spec content-publication) — the notify-subscribers action
// through the email worker with the delivery intent log.
// ---------------------------------------------------------------------------

const notifySchema = z.object({
  subject: z
    .string({ required_error: 'subject is required', invalid_type_error: 'subject is required' })
    .min(1, 'subject is required')
    .max(255, 'subject must be at most 255 characters')
    .refine((value) => !/[\r\n]/.test(value), 'subject must not contain line breaks'),
  bodyFi: z
    .string({ required_error: 'bodyFi is required', invalid_type_error: 'bodyFi is required' })
    .min(1, 'bodyFi is required'),
  bodyEn: z
    .string({ required_error: 'bodyEn is required', invalid_type_error: 'bodyEn is required' })
    .min(1, 'bodyEn is required'),
});

/**
 * POST /ops/console/newsletter/notify — one broadcast to every ACTIVE
 * subscriber (PENDING is never scanned, so unconfirmed addresses are
 * never mailed). The pipeline is the alert intent-log pattern: per
 * subscriber, cooldown → PENDING intent row → dispatch through the
 * email worker → outcome mark, so a retried action skips subscribers
 * already marked delivered (crash-safe, spec). Unconfigured email
 * delivery fails closed with the console's 503 StoreUnavailable.
 */
async function notifySubscribers(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(notifySchema, dto);

  const config = {
    frontendOrigin:
      (c.env as { APP_PUBLIC_URL?: string }).APP_PUBLIC_URL ?? 'https://rajahinta.fi',
    emailWorkerUrl: c.env.EMAIL_WORKER_URL,
    emailSendSecret: c.env.EMAIL_SEND_SECRET,
  };
  if (!config.emailWorkerUrl || !config.emailSendSecret) {
    throw new ApiHttpError(503, {
      statusCode: 503,
      message:
        'newsletter delivery is not configured (EMAIL_WORKER_URL / EMAIL_SEND_SECRET)',
      error: 'StoreUnavailable',
    });
  }

  const result = await notifyNewsletterSubscribers(
    c.env.DB,
    config,
    content,
    createLogger(c.env.LOG_LEVEL),
  );

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'newsletter_broadcast',
    entityId: crypto.randomUUID(),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Newsletter broadcast via operator console',
    newValue: {
      subject: content.subject,
      total: result.total,
      notified: result.notified,
      failed: result.failed,
      skipped: result.skipped,
    },
  });

  return c.json(result);
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

  // Producer links (task 6.1, R9) — audited CRUD over the curated
  // sibling-product evidence. Same POST-style mutation shape as the
  // ferry offers: the DELETE is POST :id/delete so the acting operator
  // + reason travel in the body like every other console mutation.
  // Writes are console-only; the public dupes API (6.3) only reads.
  app.get('/ops/console/producer-links', listProducerLinks);
  app.post('/ops/console/producer-links', createProducerLink);
  app.post('/ops/console/producer-links/:id', updateProducerLink);
  app.post('/ops/console/producer-links/:id/publish', publishProducerLink);
  app.post('/ops/console/producer-links/:id/delete', deleteProducerLink);

  // curated list entries (7.1, R10): DRAFT → PUBLISHED via publish,
  // PUBLISHED → DRAFT via unpublish (spec: entries are created,
  // updated, and unpublished here — published content is editable, so
  // content work never needs a deploy). The DELETE is POST :id/delete
  // so the acting operator + reason travel in the body like every
  // other console mutation.
  app.get('/ops/console/curated-entries', listCuratedEntries);
  app.post('/ops/console/curated-entries', createCuratedEntry);
  app.post('/ops/console/curated-entries/:id', updateCuratedEntry);
  app.post('/ops/console/curated-entries/:id/publish', publishCuratedEntry);
  app.post('/ops/console/curated-entries/:id/unpublish', unpublishCuratedEntry);
  app.post('/ops/console/curated-entries/:id/delete', deleteCuratedEntry);

  // Blog posts (task 5.1, trust-and-reach-roadmap) — the human
  // publication gate over the rate-confirmation hook's drafts. Console
  // read + audited publish; there is deliberately NO auto-publish path.
  app.get('/ops/console/blog/posts', listBlogPosts);
  app.post('/ops/console/blog/posts/:id/publish', publishBlogPost);

  // Shop-report moderation + blacklist (task 2.3, trust-and-reach-roadmap)
  // — the review queue (OPEN + evidence, link/reject), the publish
  // action (published standard enforced server-side), and the appeal
  // path (record + REPUBLISH/REJECT resolve). Every mutation appends to
  // the audit trail; all ride the /ops/console/* guard prefix.
  app.get('/ops/console/reports', listReportQueue);
  app.post('/ops/console/reports/:id/link', linkReport);
  app.post('/ops/console/reports/:id/reject', rejectReport);
  app.get('/ops/console/blacklist/entries', listBlacklistEntries);
  app.post('/ops/console/blacklist/publish', publishBlacklistEntry);
  app.get('/ops/console/blacklist/appeals', listAppeals);
  app.post('/ops/console/blacklist/:id/appeal', recordAppeal);
  app.post('/ops/console/blacklist/:id/resolve', resolveAppeal);

  // Newsletter broadcast (task 5.3, trust-and-reach-roadmap) — the
  // notify-subscribers action through the email worker's send contract
  // with the delivery intent log (crash-safe redelivery).
  app.post('/ops/console/newsletter/notify', notifySubscribers);

  app.get('/ops/console/audit', recentAudit);
  return app;
}

export type { D1DatabaseLike };

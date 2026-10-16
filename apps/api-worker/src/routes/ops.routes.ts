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
 * Task 3.1 (change alko-reference-matching-pipeline) adds the
 * match-review queue — the Alko reference-linking trust gate (design
 * D2): the side-by-side queue listing, attributed confirm/reject (a
 * confirm creates the CONFIRMED product_reference_links row and flips
 * the review row in one repository transaction), and the supersede path
 * the confirm-conflict 409 points at. The matching pass never writes a
 * link; nothing reaches CONFIRMED except through these endpoints.
 *
 * Task 5.1 (change transport-confidence-unlock) adds the offer
 * verification action (design D7) — the owner-gated human write path
 * that makes VERIFIED reachable: attributed, audited, re-verifiable,
 * and deliberately without an un-verify endpoint.
 *
 * Task 3.1 (change product-name-quality-gate) adds the name-quality
 * quarantine queue — the read-only enrichment listing of the rows the
 * informativeness gate stored quarantined, surfaced with the raw feed
 * name, the stripped annotation, and the merchant/freshness facts.
 *
 * Task 4.1 (change calendar-event-automation) adds the calendar event
 * candidates queue — the source-watcher's review path: the PENDING
 * worklist, accept (operator-chosen type/status/date-or-window through
 * the pure candidate state machine + the persistence-boundary event
 * validator + the calendar-events section's one INSERT; candidate
 * marked ACCEPTED), and reject (terminal REJECTED, row retained so the
 * URL keeps deduplicating). Candidates are console-only data — the
 * public calendar endpoints read calendar_events and never candidates.
 *
 * EVERY mutating action writes an append-only D1 `audit_events` row via
 * the task-2.5 D1AuditEventRepository (WorkerAuditService).
 *
 * ## Fail-closed stores (documented scope note, task 3.8)
 *
 * - Tax rate-review REJECTIONS still have no store to record a
 *   resolution into (2.5 ported sessions, audit, watermarks, registry),
 *   so reject rejects with 503 rather than fabricating persistence.
 *   APPROVE is the versioned-publication confirmation gate (task 3.2,
 *   change calendar-event-automation): `:id` is the confirmed dataset
 *   version label, the audit trail is the durable confirmation record,
 *   and the confirmation fans out fail-open (alerts, blog drafts, and
 *   the CONFIRMED FI_EXCISE_CHANGE calendar event for a new effective
 *   year).
 * - The correction queue's writes still reject with 503 (no D1 table).
 * - Source governance (task 2.2, change durable-source-governance-store)
 *   is DURABLE now: the list joins the merchant registry with the
 *   D1SourceGovernanceRepository's aggregated `checkPermission` (never
 *   overstated), and grant/revoke mutate the `source_governance` table
 *   with the Nest OpsGovernanceService semantics, auditing through
 *   WorkerAuditService. The former governanceUnavailable() 503 is gone —
 *   the console has no known-unservable governance mutation.
 *
 * @module OpsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { ApiHttpError } from '../errors';
import { parseIntParam } from './support';
import { WorkerAuditService } from '../adapters/audit';
import { D1MerchantRegistryRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-registry.repository';
import { D1SourceGovernanceRepository } from '../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import type {
  AcquisitionMethod,
  PermissionStatus,
  SourceGovernanceRecord,
} from '../../../../packages/core-domain/src/governance/source-governance.types';
import {
  D1ConsumptionNormsRepository,
  MissingNormSourceCitationError,
} from '../../../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import { D1MatchReviewRepository } from '../../../../packages/data-platform/src/repositories/d1/match-review.repository';
import { D1ReferenceLinkRepository } from '../../../../packages/data-platform/src/repositories/d1/reference-link.repository';
import {
  MatchReviewAlreadyDecidedError,
  MissingDecisionAttributionError,
  ReferenceLinkConflictError,
  type MatchReviewRecord,
  type MatchReviewStatus,
} from '../../../../packages/data-platform/src/abstracts';
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
import type { BlogPostKind } from '../../../../packages/data-platform/src/abstracts';
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
import { runRateConfirmationHooks } from '../cron/rate-confirmation';
import { runCalendarEventFanout } from '../cron/calendar-event-fanout';
import { passesContentPolicy } from '../../../../packages/core-domain/src/content/content-lint';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import {
  validateCalendarEvent,
  type CalendarEventInput,
  type ValidatedCalendarEvent,
} from '../../../../packages/data-platform/src/repositories/calendar-event-validator';
import { DrizzleCalendarEventRepository } from '../../../../packages/data-platform/src/repositories/calendar-event.repository';
import { calendarEventBody } from './calendar.routes';
import {
  acceptCandidate,
  rejectCandidate,
  InvalidCandidateTransitionError,
  type CalendarCandidateAcceptanceForm,
  type CalendarEventCandidate,
} from '../../../../packages/core-domain/src/calendar/calendar.candidate';
import { InvalidCalendarInputError } from '../../../../packages/core-domain/src/calendar/calendar.types';
import { D1CalendarCandidateRepository } from '../adapters/d1-calendar-candidate.repository';

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
// Governance — durable source_governance store (task 2.2, change
// durable-source-governance-store; Nest OpsGovernanceService semantics)
// ---------------------------------------------------------------------------

/**
 * Aggregate statuses with the port's first-match-wins priority — the same
 * ordering D1SourceGovernanceRepository.checkPermission applies. Only
 * called with non-empty record sets (snapshot/revoke paths), so the
 * fallback never fires in practice.
 */
function aggregateGovernanceStatus(
  records: readonly SourceGovernanceRecord[],
): PermissionStatus {
  const priority = ['GRANTED', 'PENDING', 'EXPIRED', 'REVOKED'] as const;
  return (
    priority.find((candidate) =>
      records.some((record) => record.permissionStatus === candidate),
    ) ?? 'PENDING'
  );
}

/**
 * GET /ops/console/governance — registry merchants joined with their
 * aggregated governance state, the console's grant/revoke worklist.
 * Merchants without governance records surface as PENDING with zero
 * sources (never overstated).
 */
async function listGovernance(c: Context<AppEnv>): Promise<Response> {
  const governance = new D1SourceGovernanceRepository(c.env.DB);
  const merchants = await new D1MerchantRegistryRepository(c.env.DB).list();

  // The console item shape (OpsGovernanceMerchant / ops.dto.ts parity) —
  // the exact keys the frontend's governance types render.
  const items: {
    merchantId: string;
    name: string;
    country: string;
    feedUrl: string;
    permissionStatus: PermissionStatus;
    sourceCount: number;
    hasWarnings: boolean;
  }[] = [];
  for (const merchant of merchants) {
    const check = await governance.checkPermission(merchant.merchantId);
    items.push({
      merchantId: merchant.merchantId,
      name: merchant.name,
      country: merchant.country,
      feedUrl: merchant.feedUrl,
      permissionStatus: check.permissionStatus,
      sourceCount: check.sources.length,
      hasWarnings: check.hasWarnings,
    });
  }
  return c.json({ items, total: items.length });
}

/**
 * POST /ops/console/governance/:merchantId/grant — Nest
 * OpsGovernanceService.grantPermission parity: the first PENDING or
 * EXPIRED record transitions to GRANTED; a merchant with no records gets
 * a new GRANTED source registered; an already-fully-granted merchant is a
 * no-op (`changed: false`, nothing audited). Every state change appends a
 * `source_governance` audit row (operator identity, before/after, note).
 */
async function grantGovernance(c: Context<AppEnv>): Promise<Response> {
  const merchantId = c.req.param('merchantId') ?? '';
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

  const merchant = await new D1MerchantRegistryRepository(c.env.DB).findByMerchantId(
    merchantId,
  );
  if (merchant === null) {
    throw new ApiHttpError(404, `Merchant "${merchantId}" is not in the registry`);
  }

  const repo = new D1SourceGovernanceRepository(c.env.DB);
  const records = await repo.findByMerchantId(merchantId);
  const note = (dto.note as string | undefined)?.trim() || undefined;

  const transitionable = records.find(
    (record) =>
      record.permissionStatus === 'PENDING' || record.permissionStatus === 'EXPIRED',
  );

  let action: 'created' | 'updated';
  let granted: SourceGovernanceRecord;
  let previousStatus: PermissionStatus | undefined;

  if (transitionable !== undefined) {
    previousStatus = transitionable.permissionStatus;
    const updated = await repo.updateStatus(transitionable.id, 'GRANTED', note);
    if (updated === null) {
      throw new ApiHttpError(
        404,
        `Governance record ${transitionable.id} disappeared mid-grant`,
      );
    }
    granted = updated;
    action = 'updated';
  } else if (records.length === 0) {
    granted = await repo.create({
      merchantId,
      acquisitionMethod: dto.acquisitionMethod as AcquisitionMethod,
      permissionStatus: 'GRANTED',
      sourceUrl: dto.sourceUrl as string,
    });
    action = 'created';
  } else {
    // Every source already GRANTED — the requested state already holds.
    return c.json({
      merchantId,
      permissionStatus: aggregateGovernanceStatus(records),
      updatedSources: 0,
      changed: false,
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'source_governance',
    entityId: merchantId,
    action,
    author: dto.operator as string,
    reason: note ?? 'Governance permission granted via operator console',
    ...(previousStatus !== undefined
      ? { previousValue: { permissionStatus: previousStatus } }
      : {}),
    newValue: {
      permissionStatus: 'GRANTED',
      acquisitionMethod: granted.acquisitionMethod,
      sourceUrl: granted.sourceUrl,
    },
  });

  const check = await repo.checkPermission(merchantId);
  return c.json({
    merchantId,
    permissionStatus: check.permissionStatus,
    updatedSources: 1,
    changed: true,
  });
}

/**
 * POST /ops/console/governance/:merchantId/revoke — the primary
 * revocation path (Nest revokePermission parity): reason mandatory,
 * unknown merchants and merchants without records 404, every non-REVOKED
 * source ends, and the decision is audited with the aggregated before
 * status and the revoked count.
 */
async function revokeGovernance(c: Context<AppEnv>): Promise<Response> {
  const merchantId = c.req.param('merchantId') ?? '';
  const dto = await readBody(c);
  validateOperator(dto);
  if (typeof dto.reason !== 'string' || dto.reason.trim() === '') {
    throw new ApiHttpError(400, 'reason is required for revocation');
  }

  const merchant = await new D1MerchantRegistryRepository(c.env.DB).findByMerchantId(
    merchantId,
  );
  if (merchant === null) {
    throw new ApiHttpError(404, `Merchant "${merchantId}" is not in the registry`);
  }

  const repo = new D1SourceGovernanceRepository(c.env.DB);
  const records = await repo.findByMerchantId(merchantId);
  if (records.length === 0) {
    throw new ApiHttpError(
      404,
      `Merchant "${merchantId}" has no governance records to revoke`,
    );
  }

  const reason = dto.reason.trim();
  const revokedCount = await repo.revokeAllByMerchantId(merchantId, reason);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'source_governance',
    entityId: merchantId,
    action: 'updated',
    author: dto.operator as string,
    reason,
    previousValue: { permissionStatus: aggregateGovernanceStatus(records) },
    newValue: { permissionStatus: 'REVOKED', revokedSources: revokedCount },
  });

  return c.json({
    merchantId,
    permissionStatus: 'REVOKED' as PermissionStatus,
    updatedSources: revokedCount,
    changed: revokedCount > 0,
  });
}

// ---------------------------------------------------------------------------
// Merchant registration — the "add a site" console action. Owner policy
// (2026-09-11): registering a merchant asserts permission for its public
// feed, so the registration auto-grants. Revocation stays the kill
// switch — explicit records are never overwritten by re-registration.
// ---------------------------------------------------------------------------

/** Defaults for the optional registration fields. */
const DEFAULT_FEED_FORMAT = 'json';
const DEFAULT_POLLING_INTERVAL_MS = 3_600_000;
// Merchant sites onboard through their public store APIs (the alks
// pattern — WooCommerce Store API, source type RETAILER_API), so that is
// the default acquisition method; the body can override it.
const DEFAULT_ACQUISITION_METHOD = 'RETAILER_API';

/**
 * POST /ops/console/merchants — upsert the registry row and apply the
 * owner's blanket permission policy: a merchant with NO governance
 * records is auto-granted (GRANTED source over the registered feed URL),
 * so the next producer pass starts ingesting without a second console
 * action. Existing records — GRANTED, PENDING, EXPIRED, or REVOKED — are
 * never touched: revocation must survive re-registration. Both the
 * registry change and the auto-grant append audit rows.
 */
async function registerMerchant(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  validateOperator(dto);
  for (const field of ['merchantId', 'name', 'country', 'feedUrl'] as const) {
    const value = dto[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ApiHttpError(400, `${field} must be a non-empty string`);
    }
  }
  const acquisitionMethod =
    dto.acquisitionMethod === undefined
      ? DEFAULT_ACQUISITION_METHOD
      : dto.acquisitionMethod;
  if (!ACQUISITION_METHODS.includes(acquisitionMethod as string)) {
    throw new ApiHttpError(
      400,
      `acquisitionMethod must be one of: ${ACQUISITION_METHODS.join(', ')}`,
    );
  }
  const pollingIntervalMs =
    dto.pollingIntervalMs === undefined
      ? DEFAULT_POLLING_INTERVAL_MS
      : dto.pollingIntervalMs;
  if (
    typeof pollingIntervalMs !== 'number' ||
    !Number.isInteger(pollingIntervalMs) ||
    pollingIntervalMs <= 0
  ) {
    throw new ApiHttpError(
      400,
      'pollingIntervalMs must be a positive integer (milliseconds)',
    );
  }
  const feedFormat =
    dto.feedFormat === undefined ? DEFAULT_FEED_FORMAT : dto.feedFormat;
  if (typeof feedFormat !== 'string' || feedFormat.trim() === '') {
    throw new ApiHttpError(400, 'feedFormat must be a non-empty string');
  }

  const merchantId = (dto.merchantId as string).trim();
  const feedUrl = (dto.feedUrl as string).trim();
  const registry = new D1MerchantRegistryRepository(c.env.DB);
  const existing = await registry.findByMerchantId(merchantId);

  const merchant = await registry.upsert({
    merchantId,
    name: (dto.name as string).trim(),
    country: (dto.country as string).trim(),
    feedUrl,
    feedFormat: (feedFormat as string).trim(),
    pollingIntervalMs,
  });

  const governance = new D1SourceGovernanceRepository(c.env.DB);
  const audit = new WorkerAuditService(c.env.DB);
  const operator = dto.operator as string;
  const note = (dto.note as string | undefined)?.trim();

  await audit.logChange({
    entityType: 'merchant_registry',
    entityId: merchantId,
    action: existing === null ? 'created' : 'updated',
    author: operator,
    reason: note ?? 'Merchant registered via operator console',
    ...(existing !== null
      ? {
          previousValue: {
            name: existing.name,
            country: existing.country,
            feedUrl: existing.feedUrl,
          },
        }
      : {}),
    newValue: { name: merchant.name, country: merchant.country, feedUrl },
  });

  // The auto-grant fires only on an empty governance slate — an explicit
  // record (a revocation in particular) always wins over registration.
  const records = await governance.findByMerchantId(merchantId);
  let autoGranted = false;
  if (records.length === 0) {
    await governance.create({
      merchantId,
      acquisitionMethod: acquisitionMethod as AcquisitionMethod,
      permissionStatus: 'GRANTED',
      sourceUrl: feedUrl,
    });
    autoGranted = true;
    await audit.logChange({
      entityType: 'source_governance',
      entityId: merchantId,
      action: 'created',
      author: operator,
      reason:
        note ??
        'Auto-granted on registration (owner blanket policy: registering a merchant asserts permission for its public feed)',
      newValue: {
        permissionStatus: 'GRANTED',
        acquisitionMethod,
        sourceUrl: feedUrl,
      },
    });
  }

  const check = await governance.checkPermission(merchantId);
  return c.json({
    merchantId,
    name: merchant.name,
    registered: existing === null ? 'created' : 'updated',
    autoGranted,
    permissionStatus: check.permissionStatus,
    sourceCount: check.sources.length,
  });
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
// Match-review queue — the Alko reference-linking trust gate (task 3.1,
// change alko-reference-matching-pipeline; design D2, spec
// product-normalization). The matching pass queues every scored candidate;
// NOTHING becomes a CONFIRMED product_reference_links row without an
// operator decision here — the exact trust pattern of the
// consumption-norms confirm above (attributed, audited, guarded).
// ---------------------------------------------------------------------------

/** The listing filter's accepted statuses (migration 0026 CHECK). */
const MATCH_REVIEW_STATUSES: readonly MatchReviewStatus[] = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
];

/** Validate the optional status filter (kinds never mix in listings). */
function parseReviewStatusFilter(raw: string | undefined): MatchReviewStatus {
  if (raw === undefined || raw === '') return 'PENDING';
  if (!MATCH_REVIEW_STATUSES.includes(raw as MatchReviewStatus)) {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'status must be one of: PENDING, CONFIRMED, REJECTED',
      error: 'ValidationError',
    });
  }
  return raw as MatchReviewStatus;
}

/**
 * The console's review row — both universes side by side, exactly the
 * identity fields frozen at enqueue (the reviewer sees what the scorer
 * saw), plus the scoring facts. Queue listings follow the console's
 * `{ items, total }` envelope; the repository's order is deterministic
 * (score desc, then the pair ids ascending).
 */
function matchReviewItem(review: MatchReviewRecord): Record<string, unknown> {
  return {
    id: review.id,
    status: review.status,
    foreign: {
      productId: review.foreignProductId,
      name: review.foreignName,
      brand: review.foreignBrand,
      abv: review.foreignAbv,
      volume: review.foreignVolume,
    },
    alko: {
      productId: review.alkoProductId,
      name: review.alkoName,
      brand: review.alkoBrand,
      abv: review.alkoAbv,
      volume: review.alkoVolume,
    },
    confidence: review.confidence,
    method: review.matchMethod,
    score: review.score,
    createdAt: review.createdAt.toISOString(),
  };
}

/**
 * GET /ops/console/match-review?status=PENDING — the operator worklist,
 * defaulting to the pending queue (status=CONFIRMED/REJECTED read the
 * decision history).
 */
async function listMatchReview(c: Context<AppEnv>): Promise<Response> {
  const status = parseReviewStatusFilter(c.req.query('status'));
  const reviews = await new D1MatchReviewRepository(c.env.DB).listByStatus(status);
  return c.json({ items: reviews.map(matchReviewItem), total: reviews.length });
}

/**
 * Map the decision repositories' typed refusals onto the console error
 * envelope: an already-decided candidate is an invalid transition (409,
 * norms-confirm parity); a blank attribution is a validation failure
 * (400 — validateOperator already ran, so this is the repository's
 * defensive guard surfacing, never the primary rejection); a per-side
 * live-link conflict is a 409 that NAMES the blocking link, because
 * superseding it is the only legal path to the replacement.
 */
async function matchReviewHttpError(
  err: unknown,
  d1: D1DatabaseLike,
): Promise<ApiHttpError | null> {
  if (err instanceof MatchReviewAlreadyDecidedError) {
    return new ApiHttpError(409, {
      statusCode: 409,
      message: err.message,
      error: 'InvalidTransition',
    });
  }
  if (err instanceof MissingDecisionAttributionError) {
    return new ApiHttpError(400, {
      statusCode: 400,
      message: err.message,
      error: 'ValidationError',
    });
  }
  if (err instanceof ReferenceLinkConflictError) {
    const blocking = (
      await new D1ReferenceLinkRepository(d1).listConfirmed()
    ).find(
      (link) =>
        link.foreignProductId === err.foreignProductId ||
        link.alkoProductId === err.alkoProductId,
    );
    return new ApiHttpError(409, {
      statusCode: 409,
      message: err.message,
      error: 'ReferenceLinkConflict',
      conflictingLink: blocking
        ? {
            id: blocking.id,
            foreignProductId: blocking.foreignProductId,
            alkoProductId: blocking.alkoProductId,
            confirmedBy: blocking.confirmedBy,
            confirmedAt: blocking.confirmedAt?.toISOString() ?? null,
          }
        : null,
    });
  }
  return null;
}

/**
 * POST /ops/console/match-review/:id/confirm — the trust gate (design
 * D2): promotes the PENDING candidate to an attributed CONFIRMED link +
 * decided review row in one repository transaction. A per-side conflict
 * rolls the promotion back whole (the candidate stays PENDING) and the
 * 409 names the blocking link — supersede it first, then re-confirm.
 */
async function confirmMatchReview(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const repo = new D1ReferenceLinkRepository(c.env.DB);
  let decided: Awaited<ReturnType<D1ReferenceLinkRepository['confirm']>>;
  try {
    decided = await repo.confirm(id, dto.operator as string);
  } catch (err) {
    const mapped = await matchReviewHttpError(err, c.env.DB);
    if (mapped !== null) throw mapped;
    throw err;
  }
  if (decided === null) {
    throw new ApiHttpError(404, `Match review ${id} not found`);
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'match_review',
    entityId: String(id),
    action: 'confirmed',
    author: dto.operator as string,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Reference link confirmed via operator console (${decided.link.foreignProductId} → ${decided.link.alkoProductId})`,
    previousValue: {
      status: 'PENDING',
      foreignProductId: decided.review.foreignProductId,
      alkoProductId: decided.review.alkoProductId,
    },
    newValue: {
      status: 'CONFIRMED',
      linkId: decided.link.id,
      foreignProductId: decided.link.foreignProductId,
      alkoProductId: decided.link.alkoProductId,
    },
  });

  return c.json({
    id: decided.review.id,
    status: decided.review.status,
    linkId: decided.link.id,
    foreignProductId: decided.link.foreignProductId,
    alkoProductId: decided.link.alkoProductId,
    confirmedAt: decided.link.confirmedAt?.toISOString() ?? null,
  });
}

/**
 * POST /ops/console/match-review/:id/reject — record the calibration
 * decision, create NO link. Same attribution/audit contract as confirm
 * (the rejected row is scorer-calibration data per design D2).
 */
async function rejectMatchReview(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const repo = new D1ReferenceLinkRepository(c.env.DB);
  let rejected: Awaited<ReturnType<D1ReferenceLinkRepository['reject']>>;
  try {
    rejected = await repo.reject(id, dto.operator as string);
  } catch (err) {
    const mapped = await matchReviewHttpError(err, c.env.DB);
    if (mapped !== null) throw mapped;
    throw err;
  }
  if (rejected === null) {
    throw new ApiHttpError(404, `Match review ${id} not found`);
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'match_review',
    entityId: String(id),
    action: 'updated',
    author: dto.operator as string,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Match candidate rejected via operator console',
    previousValue: {
      status: 'PENDING',
      foreignProductId: rejected.foreignProductId,
      alkoProductId: rejected.alkoProductId,
    },
    newValue: { status: rejected.status },
  });

  return c.json({
    id: rejected.id,
    status: rejected.status,
    foreignProductId: rejected.foreignProductId,
    alkoProductId: rejected.alkoProductId,
    decidedAt: rejected.decidedAt?.toISOString() ?? null,
  });
}

/**
 * POST /ops/console/reference-links/:id/supersede — the replacement path
 * the confirm-conflict 409 points at (CONFIRMED → SUPERSEDED, terminal;
 * the replacement link is then created by re-confirming the queued
 * candidate). The repository's supersede carries no attribution
 * parameter — the operator identity lives in this audit row (the
 * ferry-publish pattern). The repository conflates unknown id with
 * not-live link (both null); the 404 message covers both.
 */
async function supersedeReferenceLink(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const superseded = await new D1ReferenceLinkRepository(c.env.DB).supersede(id);
  if (superseded === null) {
    throw new ApiHttpError(
      404,
      `Reference link ${id} not found or not live (SUPERSEDED is terminal)`,
    );
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'reference_link',
    entityId: String(id),
    action: 'updated',
    author: dto.operator as string,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Reference link superseded via operator console',
    previousValue: {
      status: 'CONFIRMED',
      foreignProductId: superseded.foreignProductId,
      alkoProductId: superseded.alkoProductId,
    },
    newValue: { status: superseded.status },
  });

  return c.json({
    id: superseded.id,
    status: superseded.status,
    foreignProductId: superseded.foreignProductId,
    alkoProductId: superseded.alkoProductId,
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
      'Tax rate-review rejection is unavailable: the rate-review store has no D1 ' +
      'counterpart yet (migrate-to-cloudflare 2.5). Failing closed rather than ' +
      'fabricating a resolution.',
    error: 'StoreUnavailable',
  });
}

/**
 * POST /ops/console/confirmations/tax/:id/approve — the rate-dataset
 * confirmation gate (task 3.2, change calendar-event-automation; the
 * versioned-publication flow's human sign-off).
 *
 * `:id` IS the confirmed dataset version label (the pending-review
 * store still has no D1 counterpart — the queue listing honestly
 * reports none; the operator confirms the version the daily review
 * cron detected). The durable confirmation record is the audit trail:
 * an attributed, timestamped `tax_dataset` confirmed row carrying the
 * version's official source and earliest effective date — no store,
 * no fabricated persistence. An unknown version label is a 404, so a
 * confirmation is always grounded in ingested tax_rules rows.
 *
 * At this exact point the platform fans out, each isolation boundary
 * its own (spec "Calendar event fan-out at the rate-confirmation
 * gate"):
 *
 * - TAX_CHANGE alert evaluation + FI/EN blog drafts — the established
 *   fire-and-forget seam ({@link runRateConfirmationHooks}, waitUntil,
 *   individually fail-open);
 * - the CONFIRMED FI_EXCISE_CHANGE calendar event for a NEW effective
 *   year — awaited (a confirmed fact is visible through the public
 *   calendar in the same response) and fail-open ({@link
 *   runCalendarEventFanout}: any failure is caught and logged, never
 *   blocks or rolls back the confirmation; the (year, event type) skip
 *   rule makes a re-confirmation a no-op, not a duplicate).
 */
async function approveTaxReview(c: Context<AppEnv>): Promise<Response> {
  const versionLabel = (c.req.param('id') ?? '').trim();
  if (versionLabel.length === 0 || versionLabel.length > 64) {
    throw new ApiHttpError(
      400,
      'version label must be a non-empty string (max 64 chars)',
    );
  }
  const dto = await readBody(c);
  validateOperator(dto);
  const operator = dto.operator as string;
  const log = createLogger(c.env.LOG_LEVEL);

  // Ground the confirmation in the ingested dataset: the version's
  // rules carry the official source and the effective window the
  // audit record and the calendar fan-out derive from.
  const version = await c.env.DB
    .prepare(
      `SELECT official_source, MIN(effective_from) AS earliest_effective_from
         FROM tax_rules WHERE version_label = ?`,
    )
    .bind(versionLabel)
    .first<{ official_source: string | null; earliest_effective_from: string | null }>();
  if (version === null || version.official_source === null) {
    throw new ApiHttpError(
      404,
      `Rate dataset version ${versionLabel} not found (no sourced tax_rules rows)`,
    );
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'tax_dataset',
    entityId: versionLabel,
    action: 'confirmed',
    author: operator,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Rate dataset version confirmed via operator console',
    newValue: {
      versionLabel,
      officialSource: version.official_source,
      earliestEffectiveFrom: version.earliest_effective_from,
    },
  });

  // Alerts + drafts ride the fire-and-forget seam (fail-open there);
  // the calendar fan-out is awaited and fail-open here so the event is
  // observable in this response and a failure never fails it.
  let hookCtx: { waitUntil(promise: Promise<unknown>): void } | null = null;
  try {
    hookCtx = c.executionCtx;
  } catch {
    // No runtime execution context (unit tests) — the seam runs detached.
  }
  runRateConfirmationHooks(c.env, log, hookCtx, [versionLabel]);
  await runCalendarEventFanout(c.env, log, {
    confirmedVersions: [versionLabel],
    actor: operator,
  });

  return c.json({
    id: versionLabel,
    status: 'resolved' as const,
    resolution: 'approve' as const,
    resolvedAt: new Date().toISOString(),
  });
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
//
// Guide drafts (task 5.1, change insight-surfaces; spec guides-hub) are
// created and edited here as an explicit operator action — kind GUIDE,
// with NO rate-dataset-version provenance — and published through the
// same lint-gated DRAFT-to-PUBLISHED path below, appended to the same
// audit trail.
// ---------------------------------------------------------------------------

/** Validate the optional kind filter (kinds never mix in listings). */
function parseKindFilter(raw: string | undefined): BlogPostKind | undefined {
  if (raw === undefined) return undefined;
  if (raw !== 'RATE_CHANGE' && raw !== 'GUIDE') {
    throw new ApiHttpError(400, {
      statusCode: 400,
      message: 'kind must be one of: RATE_CHANGE, GUIDE',
      error: 'ValidationError',
    });
  }
  return raw;
}

async function listBlogPosts(c: Context<AppEnv>): Promise<Response> {
  const kind = parseKindFilter(c.req.query('kind'));
  const repo = new D1BlogPostRepository(c.env.DB);
  // The console manages the launch locales as one list.
  const posts =
    kind === undefined
      ? [...(await repo.listByLocale('fi')), ...(await repo.listByLocale('en'))]
      : [...(await repo.listByLocaleAndKind('fi', kind)), ...(await repo.listByLocaleAndKind('en', kind))];
  const items = posts.map((post) => ({
    id: post.id,
    slug: post.slug,
    locale: post.locale,
    title: post.title,
    kind: post.kind,
    status: post.status,
    rateDatasetVersion: post.rateDatasetVersion,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
  }));
  return c.json({ items, total: items.length });
}

const guideCreateSchema = z.object({
  slug: z
    .string({ required_error: 'slug is required', invalid_type_error: 'slug is required' })
    .min(1, 'slug is required')
    .max(200, 'slug must be at most 200 characters')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'slug must be a lowercase URL slug (a-z, 0-9, hyphens)',
    ),
  locale: z.enum(['fi', 'en'], {
    required_error: 'locale must be one of: fi, en',
    invalid_type_error: 'locale must be one of: fi, en',
    message: 'locale must be one of: fi, en',
  }),
  title: z
    .string({ required_error: 'title is required', invalid_type_error: 'title is required' })
    .min(1, 'title is required')
    .max(255, 'title must be at most 255 characters'),
  bodyMarkdown: z
    .string({ required_error: 'bodyMarkdown is required', invalid_type_error: 'bodyMarkdown is required' })
    .min(1, 'bodyMarkdown is required'),
});

/**
 * POST /ops/console/blog/guides — create a GUIDE-kind draft. The draft
 * lands with kind GUIDE and rateDatasetVersion absent (guides carry no
 * rate-version provenance — the schema deliberately offers no such
 * field); publication is a separate human action below.
 */
async function createGuideDraft(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(guideCreateSchema, dto);

  const repo = new D1BlogPostRepository(c.env.DB);
  // The (slug, locale) unique key is the idempotency boundary — surface a
  // conflict instead of the driver's constraint error.
  const existing = await repo.findBySlugAndLocale(content.slug, content.locale);
  if (existing !== null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `A post with slug "${content.slug}" already exists for locale ${content.locale}`,
      error: 'SlugConflict',
    });
  }

  const created = await repo.create({
    slug: content.slug,
    locale: content.locale,
    title: content.title,
    bodyMarkdown: content.bodyMarkdown,
    kind: 'GUIDE',
  });

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blog_post',
    entityId: String(created.id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Guide draft created via operator console (${created.slug}/${created.locale})`,
    newValue: { kind: created.kind, slug: created.slug, locale: created.locale, status: created.status },
  });

  return c.json(
    {
      id: created.id,
      slug: created.slug,
      locale: created.locale,
      kind: created.kind,
      status: created.status,
    },
    201,
  );
}

const guideUpdateSchema = z.object({
  title: z
    .string({ invalid_type_error: 'title must be a string' })
    .min(1, 'title must not be empty')
    .max(255, 'title must be at most 255 characters')
    .optional(),
  bodyMarkdown: z
    .string({ invalid_type_error: 'bodyMarkdown must be a string' })
    .min(1, 'bodyMarkdown must not be empty')
    .optional(),
});

/**
 * POST /ops/console/blog/guides/:id — edit a GUIDE draft's title/body.
 * Only DRAFT rows are editable (what the public saw is immutable), and
 * the patch carries no rate-dataset-version field — a guide cannot grow
 * provenance it must never carry.
 */
async function editGuideDraft(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const content = parseConsoleContent(guideUpdateSchema, dto);

  const repo = new D1BlogPostRepository(c.env.DB);
  const existing = await repo.findById(id);
  if (existing === null) {
    throw new ApiHttpError(404, `Blog post ${id} not found`);
  }
  if (existing.status !== 'DRAFT') {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Blog post ${id} is not a draft (published posts are immutable)`,
      error: 'InvalidTransition',
    });
  }

  const updated = await repo.updateDraft(id, {
    title: content.title,
    bodyMarkdown: content.bodyMarkdown,
  });
  if (updated === null) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Blog post ${id} is not a draft (published posts are immutable)`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'blog_post',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Guide draft edited via operator console (${updated.slug}/${updated.locale})`,
    previousValue: { title: existing.title, status: existing.status },
    newValue: { title: updated.title, status: updated.status },
  });

  return c.json({
    id: updated.id,
    slug: updated.slug,
    locale: updated.locale,
    kind: updated.kind,
    status: updated.status,
  });
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

  // Publish-time frontend cache revalidation (change
  // revalidate-guides-on-publish): the frontend data cache holds guide/blog
  // fetches for 900 s — a publish must not wait that long to be visible.
  // Off the response path (waitUntil) and fail-open by design: a missed
  // revalidation costs at most the 900 s fallback window, never a failed
  // publish. Outcome is audited; the audit call itself is swallowed — a
  // waitUntil must never throw.
  const env = c.env as { APP_PUBLIC_URL?: string; FRONTEND_REVALIDATE_TOKEN?: string };
  const publicUrl = env.APP_PUBLIC_URL ?? 'https://rajahinta.fi';
  runAfterResponse(c, () =>
    revalidateFrontendAfterPublish(
      publicUrl,
      env.FRONTEND_REVALIDATE_TOKEN,
      String(id),
      actor,
      c.env.DB,
    ),
  );

  return c.json({
    id: published.id,
    slug: published.slug,
    locale: published.locale,
    status: published.status,
    publishedAt: published.publishedAt?.toISOString() ?? null,
  });
}

/**
 * Run work off the response path via the execution context's waitUntil.
 * Hono's `c.executionCtx` throws outside a real Workers runtime (e.g.
 * `app.request` tests) — there the work degrades to fire-and-forget so the
 * behavior is observable in tests without the runtime hook.
 */
function runAfterResponse(c: Context<AppEnv>, work: () => Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work());
  } catch {
    void work();
  }
}

/**
 * Fire-and-forget revalidation of the frontend data-cache tags after a
 * blog-post publish (design D3). Never throws: every failure mode — skip,
 * HTTP error, timeout, audit-write error — is recorded in the outcome
 * object and lands in the audit trail as an `updated` row on the post
 * (the audit action vocabulary is pinned by the D1 CHECK constraint, so
 * the ancillary outcome rides `updated` with structured `newValue`).
 */
async function revalidateFrontendAfterPublish(
  publicUrl: string,
  token: string | undefined,
  postId: string,
  actor: string,
  db: Env['DB'],
): Promise<void> {
  const outcome: Record<string, unknown> = {};
  try {
    if (typeof token !== 'string' || token.length === 0) {
      outcome.skipped = 'FRONTEND_REVALIDATE_TOKEN not configured';
    } else {
      const base = publicUrl.replace(/\/+$/, '');
      const res = await fetch(`${base}/api/internal/revalidate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-token': token,
        },
        body: JSON.stringify({ tags: ['guides', 'blog'] }),
        signal: AbortSignal.timeout(5_000),
      });
      outcome.httpStatus = res.status;
      outcome.ok = res.ok;
    }
  } catch (error) {
    outcome.error = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      await new WorkerAuditService(db).logChange({
        entityType: 'blog_post',
        entityId: postId,
        action: 'updated',
        author: actor,
        reason: 'Frontend data-cache revalidation after publish (fail-open)',
        newValue: { cacheRevalidate: outcome },
      });
    } catch {
      /* never throw from waitUntil */
    }
  }
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
    emailWorkerBinding: c.env.EMAIL_WORKER,
    emailWorkerUrl: c.env.EMAIL_WORKER_URL,
    emailSendSecret: c.env.EMAIL_SEND_SECRET,
  };
  if (
    !config.emailSendSecret ||
    (!config.emailWorkerBinding && !config.emailWorkerUrl)
  ) {
    throw new ApiHttpError(503, {
      statusCode: 503,
      message:
        'newsletter delivery is not configured (EMAIL_WORKER binding or EMAIL_WORKER_URL / EMAIL_SEND_SECRET)',
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
// Offer verification — the human write path for VERIFIED (task 5.1,
// change transport-confidence-unlock; design D7, spec operator-console)
// ---------------------------------------------------------------------------

/**
 * POST /ops/console/offers/:id/verify — set a retail offer's reliability
 * status to VERIFIED, attributed to the named operator. Deliberately NOT
 * an ingestion path: ingestion pins offers ESTIMATED at birth ("ingestion
 * never self-certifies VERIFIED"), and a human with a name on record is
 * the only writer of VERIFIED. Re-verification is allowed and overwrites
 * the verified_at/verified_by pair; each decision appends its own audit
 * row, so the history lives in the audit trail, not in the columns.
 * There is deliberately NO un-verify endpoint — superseding a verdict is
 * a later operator decision, never an accident.
 */
async function verifyOffer(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  validateOperator(dto);

  const existing = await c.env.DB.prepare(
    'SELECT merchant, product_id, reliability_status FROM retail_offers WHERE id = ?',
  )
    .bind(id)
    .first<{ merchant: string; product_id: number; reliability_status: string }>();
  if (existing === null) {
    throw new ApiHttpError(404, `Retail offer ${id} not found`);
  }

  const verifiedAt = new Date().toISOString();
  const verifiedBy = (dto.operator as string).trim();
  await c.env.DB.prepare(
    'UPDATE retail_offers SET reliability_status = ?, verified_at = ?, verified_by = ? WHERE id = ?',
  )
    .bind('VERIFIED', verifiedAt, verifiedBy, id)
    .run();

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'retail_offer',
    entityId: String(id),
    action: 'confirmed',
    author: verifiedBy,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Offer verified via operator console',
    previousValue: { reliabilityStatus: existing.reliability_status },
    newValue: { reliabilityStatus: 'VERIFIED', verifiedAt, verifiedBy },
  });

  return c.json({
    id,
    merchant: existing.merchant,
    productId: existing.product_id,
    reliabilityStatus: 'VERIFIED' as const,
    verifiedAt,
    verifiedBy,
  });
}

// ---------------------------------------------------------------------------
// Calendar events — the audited tax-change-calendar maintenance path
// (task 5.1, change tax-change-calendar; spec "Audited ops maintenance
// path")
// ---------------------------------------------------------------------------

/**
 * List / create / update the sourced price-change rhythm rows so a new
 * year's events land without a code change. Deliberately NO delete: a
 * public calendar row never dangles mid-year (design), so the public
 * endpoints only ever serve events.
 *
 * Content validation has ONE home — the persistence-boundary
 * `validateCalendarEvent` (the same contract the task-1.3 seed and the
 * task-3.1 repository writes already run through): closed vocabularies,
 * the status/precision split (CONFIRMED carries occurrence_date and
 * forbids a window; EXPECTED the reverse), real-calendar dates, http(s)
 * source, FI+EN text. Its rejections carry messages naming the valid
 * values and map to the console's 400 ValidationError envelope —
 * contract-level errors, never silent coercion. An EXPECTED → CONFIRMED
 * transition is therefore exactly "send status CONFIRMED +
 * occurrence_date (and no window)": the validator clears/forbids the
 * window by construction.
 *
 * Updates are FULL-CONTENT (every field required, re-validated as a
 * whole): the status/precision coupling makes partial status edits
 * ambiguous, so the console form always submits the complete row.
 *
 * Every create/update appends a `calendar_event` audit row (operator
 * identity, before/after, note) through the same WorkerAuditService as
 * every console mutation. Creation time for the listing lives in that
 * audit trail, not duplicated into the response rows.
 *
 * Listing order: year ascending, then the deterministic in-year order
 * the repository's pure-module sort applies (period start, CONFIRMED
 * before EXPECTED, then type, then id) — year reads go through the same
 * DrizzleCalendarEventRepository the public API uses, so the console can
 * never disagree with the public listing about a row's order.
 */

/** Map the request body onto the validator's input shape. The validator
 * re-checks every field's type at runtime (undefined fails loudly with
 * the column named), so the console never pre-coerces. */
function calendarEventInputFromDto(
  dto: Record<string, unknown>,
): CalendarEventInput {
  return {
    year: dto.year as number,
    eventType: dto.eventType as string,
    status: dto.status as string,
    occurrenceDate: (dto.occurrenceDate ?? null) as string | null,
    expectedWindow: (dto.expectedWindow ?? null) as string | null,
    titleFi: dto.titleFi as string,
    titleEn: dto.titleEn as string,
    summaryFi: dto.summaryFi as string,
    summaryEn: dto.summaryEn as string,
    sourceUrl: dto.sourceUrl as string,
  };
}

/** Run the body through the persistence-boundary validator, mapping its
 * contract-level Error onto the console's 400 ValidationError envelope. */
function validateConsoleCalendarEvent(
  dto: Record<string, unknown>,
): ValidatedCalendarEvent {
  try {
    return validateCalendarEvent(calendarEventInputFromDto(dto));
  } catch (err) {
    if (err instanceof Error && !(err instanceof ApiHttpError)) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'ValidationError',
      });
    }
    throw err;
  }
}

/** The audit trail's before/after value — the full sourced row content. */
function calendarEventAuditValue(event: ValidatedCalendarEvent): Record<
  string,
  unknown
> {
  return {
    year: event.year,
    eventType: event.eventType,
    status: event.status,
    occurrenceDate: event.occurrenceDate,
    expectedWindow: event.expectedWindow,
    titleFi: event.titleFi,
    titleEn: event.titleEn,
    summaryFi: event.summaryFi,
    summaryEn: event.summaryEn,
    sourceUrl: event.sourceUrl,
  };
}

async function listCalendarEvents(c: Context<AppEnv>): Promise<Response> {
  const repo = new DrizzleCalendarEventRepository(c.env.DB);
  // Distinct years first (one indexed column, ascending), then the port's
  // per-year deterministic reads — no cross-year ordering is re-invented
  // here, and empty years simply contribute nothing.
  const years = await c.env.DB.prepare(
    'SELECT DISTINCT year FROM calendar_events ORDER BY year ASC',
  ).all<{ year: number }>();
  const events = [];
  for (const row of years.results) {
    events.push(...(await repo.listByYear(row.year)));
  }
  return c.json({
    items: events.map(calendarEventBody),
    total: events.length,
  });
}

/** The calendar-events section's insert path — also the accept-a-candidate
 * event creation (task 4.1): autoassigned id beyond every existing row
 * (the seed's documented contract: ops-created rows live outside the
 * seed's id range and are never touched by re-seeding; single-operator
 * console — no allocation race to defend against), validated content
 * only. Every event write the console performs funnels through here so
 * there is exactly one INSERT into the public table. */
async function insertCalendarEventRow(
  d1: D1DatabaseLike,
  validated: ValidatedCalendarEvent,
): Promise<number> {
  const head = await d1
    .prepare('SELECT MAX(id) AS max_id FROM calendar_events')
    .first<{ max_id: number | null }>();
  const id = (head?.max_id ?? 0) + 1;

  await d1
    .prepare(
      'INSERT INTO calendar_events ' +
        '(id, year, event_type, status, occurrence_date, expected_window, ' +
        'title_fi, title_en, summary_fi, summary_en, source_url) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      validated.year,
      validated.eventType,
      validated.status,
      validated.occurrenceDate,
      validated.expectedWindow,
      validated.titleFi,
      validated.titleEn,
      validated.summaryFi,
      validated.summaryEn,
      validated.sourceUrl,
    )
    .run();
  return id;
}

async function createCalendarEvent(c: Context<AppEnv>): Promise<Response> {
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const validated = validateConsoleCalendarEvent(dto);

  const id = await insertCalendarEventRow(c.env.DB, validated);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'calendar_event',
    entityId: String(id),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Calendar event created via operator console',
    newValue: calendarEventAuditValue(validated),
  });

  return c.json({ id, ...calendarEventAuditValue(validated) });
}

async function updateCalendarEvent(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);
  const validated = validateConsoleCalendarEvent(dto);

  const existing = await c.env.DB.prepare(
    'SELECT year, event_type, status, occurrence_date, expected_window, ' +
      'title_fi, title_en, summary_fi, summary_en, source_url ' +
      'FROM calendar_events WHERE id = ?',
  )
    .bind(id)
    .first<{
      year: number;
      event_type: string;
      status: string;
      occurrence_date: string | null;
      expected_window: string | null;
      title_fi: string;
      title_en: string;
      summary_fi: string;
      summary_en: string;
      source_url: string;
    }>();
  if (existing === null) {
    throw new ApiHttpError(404, `Calendar event ${id} not found`);
  }

  // In-place edit of the same row — no delete, no re-create: the row's
  // id (and any public reference to it) survives status transitions.
  await c.env.DB.prepare(
    'UPDATE calendar_events SET year = ?, event_type = ?, status = ?, ' +
      'occurrence_date = ?, expected_window = ?, title_fi = ?, title_en = ?, ' +
      'summary_fi = ?, summary_en = ?, source_url = ? WHERE id = ?',
  )
    .bind(
      validated.year,
      validated.eventType,
      validated.status,
      validated.occurrenceDate,
      validated.expectedWindow,
      validated.titleFi,
      validated.titleEn,
      validated.summaryFi,
      validated.summaryEn,
      validated.sourceUrl,
      id,
    )
    .run();

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'calendar_event',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Calendar event updated via operator console',
    previousValue: {
      year: existing.year,
      eventType: existing.event_type,
      status: existing.status,
      occurrenceDate: existing.occurrence_date,
      expectedWindow: existing.expected_window,
      titleFi: existing.title_fi,
      titleEn: existing.title_en,
      summaryFi: existing.summary_fi,
      summaryEn: existing.summary_en,
      sourceUrl: existing.source_url,
    },
    newValue: calendarEventAuditValue(validated),
  });

  return c.json({ id, ...calendarEventAuditValue(validated) });
}

// ---------------------------------------------------------------------------
// Calendar event candidates — the source-watcher's review queue (task 4.1,
// change calendar-event-automation)
// ---------------------------------------------------------------------------

/**
 * The ops review queue over the watcher's PENDING proposals (task 3.3):
 * list, accept (candidate → audited calendar event), reject (terminal,
 * row retained so its URL keeps deduplicating). NEVER public: the rows
 * carry internal workflow state, the public calendar endpoints read
 * only `calendar_events`, and an accepted event reaches the public API
 * exclusively through this section's insert into that one table — the
 * same {@link insertCalendarEventRow} path the calendar-events
 * maintenance section uses (one INSERT into the public table).
 *
 * ## Accept ordering — insert event first, mark candidate second
 *
 * The event insert failing must NOT leave the candidate ACCEPTED, so
 * the decision is written to `calendar_events` BEFORE the candidate row
 * flips: a validator rejection (via the pure {@link acceptCandidate}
 * mapping, then the persistence-boundary `validateCalendarEvent`) or an
 * insert failure throws while the candidate is still PENDING — nothing
 * decided, retryable cleanly. The reverse failure (candidate row not
 * markable AFTER a live event exists) cannot be compensated: a public
 * calendar row never dangles mid-year (the calendar-events section's
 * own no-delete rule), so a delete-to-rollback would trade an honest
 * inconsistency for a forbidden one. Instead the failure is logged with
 * both ids and answered 409 naming the created event — the event and
 * its `calendar_event` audit row stand (both true), the candidate stays
 * PENDING (visible in the queue), and the audit trail records exactly
 * what happened. Single-operator console: the window is one request.
 *
 * ## Status transitions
 *
 * The pure state machine owns every decision ({@link acceptCandidate} /
 * {@link rejectCandidate}) — terminal states, URL identity, draft-to-
 * text resolution, year derivation, and the whole event contract check
 * live there. The route maps its typed errors: a decided-again candidate
 * is 409 InvalidTransition (match-review parity), a contract violation
 * is 400 ValidationError in the validator's own words. The repository's
 * `updateStatus ... WHERE status = 'PENDING'` is the storage-side mirror
 * of the same machine, so a stale queue view can never overwrite a
 * decision even if two operators raced.
 *
 * Every accept/reject appends a `calendar_candidate` audit row
 * (operator identity, before/after, note) through the same
 * WorkerAuditService as every console mutation; the created event
 * additionally gets the standard `calendar_event` created row.
 */

/** Map the pure state machine's typed refusals onto the console error
 * envelope (match-reviewHttpError parity — distinct reasons, no string
 * matching). */
function candidateDecisionHttpError(err: unknown): ApiHttpError | null {
  if (err instanceof InvalidCandidateTransitionError) {
    return new ApiHttpError(409, {
      statusCode: 409,
      message: err.message,
      error: 'InvalidTransition',
    });
  }
  if (err instanceof InvalidCalendarInputError) {
    return new ApiHttpError(400, {
      statusCode: 400,
      message: err.message,
      error: 'ValidationError',
    });
  }
  return null;
}

/** GET /ops/console/calendar-candidates — the PENDING worklist, newest
 * detected first (the repository's deterministic order). Drafts ride the
 * rows: they pre-fill the accept form's optional overrides. */
async function listCalendarCandidates(c: Context<AppEnv>): Promise<Response> {
  const candidates = await new D1CalendarCandidateRepository(
    c.env.DB,
  ).listPending();
  return c.json({ items: candidates.map(candidateItem), total: candidates.length });
}

/** The console's candidate row — the watcher's proposal facts. */
function candidateItem(
  candidate: CalendarEventCandidate & { id: number },
): Record<string, unknown> {
  return {
    id: candidate.id,
    source: candidate.source,
    url: candidate.url,
    title: candidate.title,
    publishedAt: candidate.publishedAt,
    status: candidate.status,
    draftFi: candidate.draftFi,
    draftEn: candidate.draftEn,
  };
}

/** The operator's accept form as the request carries it. The exact-one
 * date-or-window rule, the closed vocabularies, and the year derivation
 * are the pure mapping's checks — the route never pre-coerces. */
function acceptanceFormFromDto(dto: Record<string, unknown>): CalendarCandidateAcceptanceForm {
  const override = (key: 'titleFi' | 'titleEn' | 'summaryFi' | 'summaryEn'): string | undefined =>
    dto[key] === undefined ? undefined : (dto[key] as string);
  return {
    eventType: dto.eventType as CalendarCandidateAcceptanceForm['eventType'],
    status: dto.status as CalendarCandidateAcceptanceForm['status'],
    occurrenceDate: (dto.occurrenceDate ?? null) as string | null,
    expectedWindow: (dto.expectedWindow ?? null) as string | null,
    titleFi: override('titleFi'),
    titleEn: override('titleEn'),
    summaryFi: override('summaryFi'),
    summaryEn: override('summaryEn'),
  };
}

/** POST /ops/console/calendar-candidates/:id/accept — the operator's
 * calendar framing (type, status, date-or-window, optional FI/EN text
 * overrides) turns the PENDING candidate into a publicly visible event
 * per its status. See the section doc for the ordering and the audit
 * trail. */
async function acceptCalendarCandidate(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1CalendarCandidateRepository(c.env.DB);
  const stored = await repo.findById(id);
  if (stored === null) {
    throw new ApiHttpError(404, `Calendar candidate ${id} not found`);
  }

  // The pure decision: validates the candidate row, the transition, and
  // the whole event combination (in the event contract's own words)
  // BEFORE anything is written.
  let accepted: ReturnType<typeof acceptCandidate>;
  try {
    accepted = acceptCandidate(stored, acceptanceFormFromDto(dto));
  } catch (err) {
    const mapped = candidateDecisionHttpError(err);
    if (mapped !== null) throw mapped;
    throw err;
  }

  // The event rides the persistence-boundary validator + the one INSERT
  // the calendar-events section uses — publicly visible per its status
  // immediately. A failure here leaves the candidate PENDING (ordering:
  // section doc).
  const validated = validateConsoleCalendarEvent(
    accepted.event as unknown as Record<string, unknown>,
  );
  const eventId = await insertCalendarEventRow(c.env.DB, validated);

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'calendar_event',
    entityId: String(eventId),
    action: 'created',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Calendar event accepted from candidate ${id} (${stored.source})`,
    newValue: calendarEventAuditValue(validated),
  });

  // Storage-side terminal-state guard: false means the candidate was no
  // longer PENDING. The event is already live and audited — this is the
  // uncompensatable direction (section doc): report it honestly instead
  // of pretending the decision did not happen.
  const marked = await repo.updateStatus(id, 'ACCEPTED');
  if (!marked) {
    const log = createLogger(c.env.LOG_LEVEL);
    log.error({
      message:
        `Calendar candidate accept inconsistency: event ${eventId} was created and audited ` +
        `but candidate ${id} could not be marked ACCEPTED (no longer PENDING — decided ` +
        'concurrently or row changed mid-request). The public event stands; the queue row ' +
        'needs a manual decision. No candidate-status compensation exists by design: a public ' +
        'calendar row never dangles mid-year.',
      candidateId: id,
      eventId,
    });
    throw new ApiHttpError(409, {
      statusCode: 409,
      message:
        `Candidate ${id} could not be marked ACCEPTED — it was no longer PENDING, but calendar ` +
        `event ${eventId} was already created and is publicly visible. Repair the queue row ` +
        'manually (the audit trail carries the event creation).',
      error: 'CandidateMarkConflict',
      eventId,
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'calendar_candidate',
    entityId: String(id),
    // The match-review confirm's action word: the trust-gate moment.
    action: 'confirmed',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      `Candidate accepted via operator console (${stored.source})`,
    previousValue: { status: 'PENDING', url: stored.url, source: stored.source },
    newValue: {
      status: 'ACCEPTED',
      url: stored.url,
      eventId,
      eventType: validated.eventType,
      eventStatus: validated.status,
    },
  });

  return c.json({
    id,
    status: 'ACCEPTED',
    eventId,
    event: calendarEventAuditValue(validated),
  });
}

/** POST /ops/console/calendar-candidates/:id/reject — terminal REJECTED;
 * the row is RETAINED (no delete path exists): rejection is what keeps
 * the URL known, so the same announcement never re-enters the queue
 * (the watcher's dedup reads every stored URL, any status). */
async function rejectCalendarCandidate(c: Context<AppEnv>): Promise<Response> {
  const id = parseIntParam(c, 'id');
  const dto = await readBody(c);
  const actor = requireOperator(dto);

  const repo = new D1CalendarCandidateRepository(c.env.DB);
  const stored = await repo.findById(id);
  if (stored === null) {
    throw new ApiHttpError(404, `Calendar candidate ${id} not found`);
  }

  try {
    rejectCandidate(stored);
  } catch (err) {
    const mapped = candidateDecisionHttpError(err);
    if (mapped !== null) throw mapped;
    throw err;
  }

  // Same storage-side guard as accept; nothing public was written here,
  // so a lost race is a plain 409 with nothing to repair.
  const marked = await repo.updateStatus(id, 'REJECTED');
  if (!marked) {
    throw new ApiHttpError(409, {
      statusCode: 409,
      message: `Candidate ${id} is no longer PENDING — ACCEPTED and REJECTED are terminal`,
      error: 'InvalidTransition',
    });
  }

  await new WorkerAuditService(c.env.DB).logChange({
    entityType: 'calendar_candidate',
    entityId: String(id),
    action: 'updated',
    author: actor,
    reason:
      (dto.note as string | undefined)?.trim() ||
      'Candidate rejected via operator console (row retained for URL dedup)',
    previousValue: { status: 'PENDING', url: stored.url, source: stored.source },
    newValue: { status: 'REJECTED', url: stored.url },
  });

  return c.json({ id, status: 'REJECTED', url: stored.url });
}

// ---------------------------------------------------------------------------
// Name-quality quarantine queue — the enrichment listing (task 3.1,
// change product-name-quality-gate; spec product-normalization).
// ---------------------------------------------------------------------------

/**
 * GET /ops/console/name-quality/quarantined — the operator enrichment
 * queue: every product_master row the informativeness gate stored
 * 'quarantined'. Console listing envelope ({ items, total }), full set
 * with no pagination — the queue is the gate's quarantine share of the
 * catalog (every other ops listing returns the full set too; only the
 * audit trail caps its length).
 *
 * Raw-name sourcing: for a quarantined row the spec keeps the raw feed
 * name UNCHANGED as the display name ("preserved unchanged whenever the
 * display name is transformed or the product is quarantined"), so `name`
 * IS the raw feed string. There is no persisted raw-feed table to join —
 * RawFeedRecord lives only inside the ingestion pipeline, and the
 * original string remains at the merchant source. `name_annotation`
 * carries the stripped merchant parenthetical commentary when the row
 * had some.
 *
 * Merchant + observed_at come from the product's LATEST retail_offers
 * observation (product_master has no merchant column; offers are the
 * per-merchant observations). SQLite's bare-column rule keeps o.merchant
 * aligned with the MAX(o.observed_at) row. Order = oldest observation
 * first (the reports-queue convention), never-observed rows — NULL
 * observed_at — sorting first as the stalest enrichment targets.
 */
const QUARANTINED_NAMES_SQL = `
  SELECT p.id AS product_id, p.name AS name, p.name_annotation AS name_annotation,
         o.merchant AS merchant, MAX(o.observed_at) AS observed_at
  FROM product_master p
  LEFT JOIN retail_offers o ON o.product_id = p.id
  WHERE p.name_quality = 'quarantined'
  GROUP BY p.id
  ORDER BY observed_at ASC, p.id ASC`;

async function listQuarantinedNames(c: Context<AppEnv>): Promise<Response> {
  const result = await c.env.DB.prepare(QUARANTINED_NAMES_SQL).all<{
    product_id: number;
    name: string;
    name_annotation: string | null;
    merchant: string | null;
    observed_at: string | null;
  }>();
  const items = result.results.map((row) => ({
    productId: row.product_id,
    name: row.name,
    nameAnnotation: row.name_annotation,
    merchant: row.merchant,
    observedAt: row.observed_at,
  }));
  return c.json({ items, total: items.length });
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
  app.post('/ops/console/merchants', registerMerchant);

  app.get('/ops/console/confirmations', listConfirmations);
  app.post(
    '/ops/console/confirmations/consumption-norms/:id/confirm',
    confirmConsumptionNorm,
  );
  app.post('/ops/console/confirmations/tax/:id/approve', approveTaxReview);
  app.post('/ops/console/confirmations/tax/:id/reject', rejectTaxReview);

  // Match-review queue (task 3.1, alko-reference-matching-pipeline) — the
  // Alko reference-linking trust gate (design D2): the side-by-side queue
  // listing and the attributed confirm/reject decisions; supersede is the
  // replacement path the confirm-conflict 409 points at. Mutations ride
  // the POST body like every console mutation (operator + note).
  app.get('/ops/console/match-review', listMatchReview);
  app.post('/ops/console/match-review/:id/confirm', confirmMatchReview);
  app.post('/ops/console/match-review/:id/reject', rejectMatchReview);
  app.post('/ops/console/reference-links/:id/supersede', supersedeReferenceLink);

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
  // Guides (task 5.1, insight-surfaces) add the operator create/edit
  // draft actions — kind GUIDE, no rate-version provenance — publishing
  // through the same /posts/:id/publish transition.
  app.get('/ops/console/blog/posts', listBlogPosts);
  app.post('/ops/console/blog/posts/:id/publish', publishBlogPost);
  app.post('/ops/console/blog/guides', createGuideDraft);
  app.post('/ops/console/blog/guides/:id', editGuideDraft);

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

  // Offer verification (task 5.1, transport-confidence-unlock, D7) —
  // the owner-gated human write path for VERIFIED: attributed, audited,
  // re-verifiable; deliberately no un-verify.
  app.post('/ops/console/offers/:id/verify', verifyOffer);

  // Calendar events (task 5.1, tax-change-calendar) — the audited
  // maintenance path over the sourced price-change rhythm: list, create,
  // update (full-content, validated by the persistence-boundary contract
  // the seed and repository share). Deliberately NO delete — a public
  // calendar row never dangles mid-year.
  app.get('/ops/console/calendar-events', listCalendarEvents);
  app.post('/ops/console/calendar-events', createCalendarEvent);
  app.post('/ops/console/calendar-events/:id', updateCalendarEvent);

  // Calendar event candidates (task 4.1, calendar-event-automation) —
  // the source-watcher's review queue: the PENDING worklist, accept
  // (candidate → publicly visible event per its status, through the
  // persistence-boundary validator + the calendar-events section's one
  // INSERT), reject (terminal, row retained for URL dedup). Console-only:
  // the public calendar endpoints read calendar_events and nothing else.
  app.get('/ops/console/calendar-candidates', listCalendarCandidates);
  app.post('/ops/console/calendar-candidates/:id/accept', acceptCalendarCandidate);
  app.post('/ops/console/calendar-candidates/:id/reject', rejectCalendarCandidate);

  // Name-quality quarantine queue (task 3.1, product-name-quality-gate)
  // — the read-only enrichment listing; rides the /ops/console/* guard
  // prefix like every console read.
  app.get('/ops/console/name-quality/quarantined', listQuarantinedNames);

  app.get('/ops/console/audit', recentAudit);
  return app;
}

export type { D1DatabaseLike };

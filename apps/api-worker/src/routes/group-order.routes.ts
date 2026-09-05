/**
 * Group order API (task 9.3, change product-roadmap-phases-1-4) —
 * shared sessions with a shareable token, participant items, and the
 * accounting-only ledger compute, over the 9.1 D1GroupOrderRepository and
 * the 9.2 core-domain allocation module.
 *
 * ## Endpoints
 *
 *   POST /api/v1/group-orders                            session create (authenticated owner)
 *   POST /api/v1/group-orders/:shareToken/join           join by share link (no account)
 *   POST /api/v1/group-orders/:shareToken/items          add an item under a nickname
 *   POST /api/v1/group-orders/:shareToken/ledger         compute the ledger (stateless)
 *
 * ## Middleware chain per request
 *
 *   create:   sessionAuth() → requireFeatureFlag('GROUP_ORDER_LEDGER') →
 *             requireAccountRateLimit('DEFAULT') → handler
 *             (the guards table registers the first two — the alerts
 *             CRUD order: an anonymous caller gets the 401 envelope, so
 *             flag state never leaks to unauthenticated callers)
 *
 *   token routes: requireFeatureFlag('GROUP_ORDER_LEDGER') →
 *             requireRateLimit(profile) → handler
 *             (deliberately NO sessionAuth — the share token IS the
 *             capability; participants join without an account, spec:
 *             participant joins by link. The flag gate comes first and
 *             applies to anonymous callers here: spec — flag off →
 *             share-link access returns the feature-disabled error.)
 *
 * ## Documented decisions
 *
 * - Share token: `crypto.randomUUID()` — a URL-safe UUIDv4 carrying 122
 *   bits of random entropy, unguessable and enumeration-infeasible.
 *   Generation lives HERE (the repository surfaces the share-token
 *   unique-constraint collision instead of retrying); a collision
 *   retries with a fresh token, 3 attempts.
 * - Expiry: fixed 7-day TTL from creation, server-set — no
 *   client-supplied lifetime (R12 data minimization: no field "for
 *   later"). `expiresAt` is the exclusive edge (9.1 repository):
 *   a token read at or past it is expired → 410 Gone; an unknown token
 *   → 404. Enforcement is on every token-scoped route.
 * - Valuation rule (the API's compute-time value resolution — the 9.1
 *   schema stores no values, R12): per product, the cheapest VERIFIED
 *   EUR retail offer (`reliability_status = 'VERIFIED'`,
 *   `currency = 'EUR'`), ties broken by offer id ascending —
 *   deterministic. EUR-only keeps this layer from inventing FX
 *   conversions (FX is a separate versioned dataset concern). A product
 *   with no VERIFIED EUR offer contributes 0 and is reported in the
 *   response's `itemValuations` (`unitValueCents: null`) — the gap is
 *   stated, never silently filled; an all-unvalued session surfaces the
 *   module's NO_ITEM_VALUE state as a 200 value state, EMPTY_SESSION
 *   likewise (value-state precedent).
 * - Participant identity: the nickname IS the module's session-scoped
 *   participant id (9.1: the only participant identity a row carries).
 *   Two participants choosing the same nickname are one ledger
 *   participant — the schema's grouping semantics.
 * - Fronting resolution: request-supplied `frontedByParticipantId` per
 *   shared-cost line, which must name an existing session participant
 *   (checked here for a clean 400; the module's
 *   UNKNOWN_FRONTING_PARTICIPANT stays as the backstop). "Owner by
 *   default" was rejected: the owner may never join as a participant, so
 *   they have no participant id to front with.
 * - Rate-limit profiles: create uses the alerts precedent
 *   (requireAccountRateLimit('DEFAULT') — account-keyed); token routes
 *   key on the edge IP (requireRateLimit) because participants are
 *   anonymous — join/items at DEFAULT, ledger at CALCULATOR (a
 *   calculation surface like event-calc/trip-calc, doing per-product
 *   offer reads).
 * - ACCOUNTING-ONLY BOUNDARY (spec, design R12): this API moves no
 *   money — every DTO rejects payment-instrument fields at the
 *   validation layer (group-order-dto.ts) and every ledger result
 *   carries the structural settlement-boundary note from the module.
 *
 * @module GroupOrderRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  addItemSchema,
  createSessionSchema,
  joinSchema,
  ledgerSchema,
  parseGroupOrderDto,
} from './group-order-dto';
import type { AddItemDto, JoinDto, LedgerDto } from './group-order-dto';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireAccountRateLimit, requireRateLimit } from '../middleware/rate-limit';
import { requireFeatureFlag, FeatureFlag } from '../middleware/feature-flags';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { D1GroupOrderRepository } from '../../../../packages/data-platform/src/repositories/d1/group-order.repository';
import type {
  GroupOrderItemRecord,
  GroupOrderSessionRecord,
} from '../../../../packages/data-platform/src/repositories/d1/group-order.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';
import { calculateGroupOrderLedger } from '../../../../packages/core-domain/src/grouporder/grouporder';
import { InvalidGroupOrderInputError } from '../../../../packages/core-domain/src/grouporder/grouporder.types';
import type {
  GroupOrderLedgerResult,
  GroupOrderParticipantInput,
  GroupOrderSharedCostLineInput,
} from '../../../../packages/core-domain/src/grouporder/grouporder.types';

/** Session lifetime — see the documented decisions. */
const GROUP_ORDER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Unique-token collision retries before giving up (see the documented decisions). */
const SHARE_TOKEN_ATTEMPTS = 3;

/** The valuation rule label echoed on ledger responses (see the documented decisions). */
const VALUATION_RULE = 'CHEAPEST_VERIFIED_EUR_OFFER';

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function toSessionJson(session: GroupOrderSessionRecord): Record<string, unknown> {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}

function toItemJson(item: GroupOrderItemRecord): Record<string, unknown> {
  return {
    id: item.id,
    participantNickname: item.participantNickname,
    productId: item.productId,
    quantity: item.quantity,
    addedAt: item.addedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Token scope — lookup + expiry enforcement on every token-scoped route
// ---------------------------------------------------------------------------

/**
 * Resolve a share token to its session or throw: unknown token → 404
 * (the token is the capability — it either names a session or it does
 * not), expired → 410 Gone (the exclusive expiry edge evaluated by the
 * 9.1 repository at the request's `now`).
 */
async function resolveTokenScope(
  repo: D1GroupOrderRepository,
  shareToken: string,
): Promise<GroupOrderSessionRecord> {
  const view = await repo.findByShareToken(shareToken);
  if (view === null) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: 'Share token not found',
      error: 'ShareTokenNotFound',
    });
  }
  if (view.expired) {
    throw new ApiHttpError(410, {
      statusCode: 410,
      message: 'Share link has expired',
      error: 'SessionExpired',
    });
  }
  return view.session;
}

// ---------------------------------------------------------------------------
// Valuation — the cheapest VERIFIED EUR offer per product (documented rule)
// ---------------------------------------------------------------------------

/** Per-product unit value in cents; null = no VERIFIED EUR offer (a stated gap, never invented). */
type ValueMap = Map<number, number | null>;

async function resolveUnitValues(
  c: Context<AppEnv>,
  productIds: number[],
): Promise<ValueMap> {
  const map: ValueMap = new Map();
  const search = new D1ProductSearchRepository(c.env.DB);
  for (const productId of productIds) {
    const offers = await search.findOffers(productId);
    const verified = offers
      .filter((offer) => offer.reliabilityStatus === 'VERIFIED' && offer.currency === 'EUR')
      .sort((a, b) => a.priceCents - b.priceCents || a.id - b.id);
    map.set(productId, verified.length > 0 ? verified[0]!.priceCents : null);
  }
  return map;
}

/** Item value in cents; an unvalued product contributes 0 (documented — the gap rides the response). */
function itemValueCents(item: GroupOrderItemRecord, values: ValueMap): number {
  const unit = values.get(item.productId);
  return unit === null || unit === undefined ? 0 : unit * item.quantity;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function createSession(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  await parseGroupOrderDto(c, createSessionSchema);
  const repo = new D1GroupOrderRepository(c.env.DB);

  // Token generation is the API layer's job (9.1): a UUIDv4 collision on
  // the unique index surfaces as a driver error — retry with a fresh
  // token, and only give up after the bounded attempts.
  for (let attempt = 0; attempt < SHARE_TOKEN_ATTEMPTS; attempt++) {
    try {
      const session = await repo.createSession({
        ownerAccountId: user.accountId,
        shareToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + GROUP_ORDER_SESSION_TTL_MS).toISOString(),
      });
      return c.json(
        {
          ...toSessionJson(session),
          shareToken: session.shareToken,
        },
        201,
      );
    } catch (err) {
      if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
        continue;
      }
      throw err;
    }
  }
  throw new ApiHttpError(500, {
    statusCode: 500,
    message: 'Could not generate a unique share token',
    error: 'InternalServerError',
  });
}

async function join(c: Context<AppEnv>): Promise<Response> {
  const repo = new D1GroupOrderRepository(c.env.DB);
  const session = await resolveTokenScope(repo, c.req.param('shareToken') ?? '');
  const body: JoinDto = await parseGroupOrderDto(c, joinSchema);

  // Joining persists nothing: the nickname becomes a participant with the
  // first added item (9.1 has no participants table — anonymity by
  // design). The response is the session state the share-link page shows.
  const [participants, items] = await Promise.all([
    repo.listParticipants(session.id),
    repo.listItems(session.id),
  ]);
  return c.json({
    session: toSessionJson(session),
    joinedAs: body.nickname,
    participants: participants.map((p) => ({
      nickname: p.participantNickname,
      itemCount: p.itemCount,
      firstAddedAt: p.firstAddedAt.toISOString(),
      lastAddedAt: p.lastAddedAt.toISOString(),
    })),
    items: items.map(toItemJson),
  });
}

async function addItem(c: Context<AppEnv>): Promise<Response> {
  const repo = new D1GroupOrderRepository(c.env.DB);
  const session = await resolveTokenScope(repo, c.req.param('shareToken') ?? '');
  const body: AddItemDto = await parseGroupOrderDto(c, addItemSchema);

  // Unknown products reject before the insert (404, not an FK error) —
  // the alerts-create precedent.
  const product = await new D1ProductSearchRepository(c.env.DB).findById(body.productId);
  if (product === null) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Product "${String(body.productId)}" not found`,
      error: 'ProductNotFound',
    });
  }

  const item = await repo.addItem({
    sessionId: session.id,
    participantNickname: body.nickname,
    productId: body.productId,
    quantity: body.quantity,
  });
  return c.json(toItemJson(item), 201);
}

async function computeLedger(c: Context<AppEnv>): Promise<Response> {
  const repo = new D1GroupOrderRepository(c.env.DB);
  const session = await resolveTokenScope(repo, c.req.param('shareToken') ?? '');
  const body: LedgerDto = await parseGroupOrderDto(c, ledgerSchema);

  const [participants, items] = await Promise.all([
    repo.listParticipants(session.id),
    repo.listItems(session.id),
  ]);

  const values = await resolveUnitValues(
    c,
    [...new Set(items.map((item) => item.productId))],
  );

  // Fronting pre-check — a clean named-value 400 ahead of the module's
  // UNKNOWN_FRONTING_PARTICIPANT backstop (see the documented decisions).
  const participantIds = new Set(participants.map((p) => p.participantNickname));
  for (const line of body.sharedCosts) {
    if (!participantIds.has(line.frontedByParticipantId)) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: `frontedByParticipantId "${line.frontedByParticipantId}" does not match any participant of this session`,
        error: 'ValidationError',
      });
    }
  }

  // Participants in join order (the 9.1 rollup order — the module's
  // deterministic tie-break basis), each with their item values in ledger
  // order; nickname = participant id (documented decision).
  const participantInput: GroupOrderParticipantInput[] = participants.map((p) => ({
    id: p.participantNickname,
    itemValueCents: items
      .filter((item) => item.participantNickname === p.participantNickname)
      .map((item) => itemValueCents(item, values)),
  }));

  const sharedCosts: GroupOrderSharedCostLineInput[] = body.sharedCosts.map((line) => ({
    label: line.label,
    cents: line.cents,
    frontedByParticipantId: line.frontedByParticipantId,
  }));

  let ledger: GroupOrderLedgerResult;
  try {
    ledger = calculateGroupOrderLedger({
      participants: participantInput,
      sharedCostCents: sharedCosts,
    });
  } catch (err) {
    // Backstop for contract violations the DTO bounds could not express
    // (e.g. shared costs on a session with no participants yet). The
    // module's message states the exact violation.
    if (err instanceof InvalidGroupOrderInputError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'ValidationError',
      });
    }
    throw err;
  }

  // Value-state passthrough: EMPTY_SESSION / NO_ITEM_VALUE ride as 200
  // value states (value-state precedent), alongside the per-item
  // valuation echo so an unvalued product is a stated gap, never a
  // silently-invented zero.
  return c.json({
    session: toSessionJson(session),
    valuationRule: VALUATION_RULE,
    itemValuations: items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitValueCents: values.get(item.productId) ?? null,
      itemValueCents: itemValueCents(item, values),
    })),
    ledger,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the group order routes (create's guards pre-register in guards.ts). */
export function registerGroupOrderRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  app.post('/api/v1/group-orders', requireAccountRateLimit('DEFAULT'), createSession);

  // Token-scope routes: flag gate first (spec — flag off → share-link
  // access returns the feature-disabled error), then the IP-keyed rate
  // limit (participants are anonymous; see the documented decisions).
  app.post(
    '/api/v1/group-orders/:shareToken/join',
    requireFeatureFlag(FeatureFlag.GROUP_ORDER_LEDGER),
    requireRateLimit('DEFAULT'),
    join,
  );
  app.post(
    '/api/v1/group-orders/:shareToken/items',
    requireFeatureFlag(FeatureFlag.GROUP_ORDER_LEDGER),
    requireRateLimit('DEFAULT'),
    addItem,
  );
  app.post(
    '/api/v1/group-orders/:shareToken/ledger',
    requireFeatureFlag(FeatureFlag.GROUP_ORDER_LEDGER),
    requireRateLimit('CALCULATOR'),
    computeLedger,
  );
  return app;
}

/**
 * Price-alert watchlist CRUD (task 2.3, change product-roadmap-phases-1-4)
 * — GET/POST/PATCH/DELETE /api/v1/account/alerts over the task-2.1
 * D1PriceAlertRepository.
 *
 * Middleware chain per request (in composition order):
 *
 *   sessionAuth() → requireFeatureFlag('PRICE_ALERTS') →
 *   requireAccountRateLimit('DEFAULT') → handler
 *
 * The first two register through the guards table (middleware/guards.ts —
 * route-coverage enumeration). The rate limit registers HERE, after the
 * guards, for two reasons: its bucket key is the authenticated account
 * (lead decision "rate-limited per profile"), so the identity must already
 * be resolved, and a flag-off deployment then rejects before any limiter
 * DO traffic. Unauthenticated callers are rejected by sessionAuth before
 * the flag is consulted, so flag state never leaks to anonymous callers.
 *
 * Documented decisions:
 * - Threshold bounds: integer cents, 1..1_000_000 (€0.01–€10,000). The
 *   schema CHECK enforces > 0; the explicit zod max keeps absurd values
 *   out of the int column — €10,000 sits far above any tracked beverage
 *   unit price, so no legitimate alert is excluded.
 * - Duplicate (account, product): 409 Conflict — the pair is guarded by a
 *   unique constraint and a second alert could only produce duplicate
 *   notifications; Conflict matches the ops-route usage of 409 for
 *   state a request cannot create.
 * - Ownership: PATCH/DELETE pass the session accountId into the
 *   repository's account-scoped queries; a foreign or absent id matches
 *   no row and surfaces as 404 (existence never leaks across accounts).
 *
 * @module AlertsRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireAccountRateLimit } from '../middleware/rate-limit';
import { parseIntParam, parseDto } from './support';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import { D1PriceAlertRepository } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import type { PriceAlertRecord } from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

/** Upper threshold bound: €10,000 in cents — see the module doc. */
const MAX_ALERT_THRESHOLD_CENTS = 1_000_000;

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

// ---------------------------------------------------------------------------
// Serialization — ISO-8601 instants; accountId omitted (caller-scoped)
// ---------------------------------------------------------------------------

function toAlertJson(row: PriceAlertRecord): Record<string, unknown> {
  return {
    id: row.id,
    productId: row.productId,
    thresholdCents: row.thresholdCents,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PRODUCT_ID_MESSAGE = 'productId must be a positive integer';

const productIdSchema = z.number({
  required_error: PRODUCT_ID_MESSAGE,
  invalid_type_error: PRODUCT_ID_MESSAGE,
}).int(PRODUCT_ID_MESSAGE).positive(PRODUCT_ID_MESSAGE);

const THRESHOLD_MESSAGE = 'thresholdCents must be a positive integer amount in euro cents';

const thresholdSchema = z.number({
  required_error: THRESHOLD_MESSAGE,
  invalid_type_error: THRESHOLD_MESSAGE,
}).int(THRESHOLD_MESSAGE).positive(THRESHOLD_MESSAGE).max(
  MAX_ALERT_THRESHOLD_CENTS,
  `thresholdCents must be at most ${MAX_ALERT_THRESHOLD_CENTS} cents (€10,000)`,
);

const createAlertSchema = z.object({
  productId: productIdSchema,
  thresholdCents: thresholdSchema,
});

const updateAlertSchema = z
  .object({
    thresholdCents: thresholdSchema.optional(),
    status: z.enum(['active', 'paused'], {
      errorMap: () => ({ message: "status must be 'active' or 'paused'" }),
    }).optional(),
  })
  // An empty patch would 404-or-noop ambiguously; require intent.
  .refine(
    (body) => body.thresholdCents !== undefined || body.status !== undefined,
    { message: 'Provide at least one of thresholdCents or status' },
  );

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listAlerts(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const alerts = await new D1PriceAlertRepository(c.env.DB).findByAccountId(
    user.accountId,
  );
  return c.json(alerts.map(toAlertJson));
}

async function createAlert(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const body = await parseDto(c, createAlertSchema);

  // Unknown products reject before the insert (404, not an FK error).
  const product = await new D1ProductSearchRepository(c.env.DB).findById(
    body.productId,
  );
  if (product === null) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Product "${body.productId}" not found`,
      error: 'ProductNotFound',
    });
  }

  try {
    const alert = await new D1PriceAlertRepository(c.env.DB).create({
      accountId: user.accountId,
      productId: body.productId,
      thresholdCents: body.thresholdCents,
    });
    return c.json(toAlertJson(alert), 201);
  } catch (err) {
    // The repository deliberately surfaces raw driver errors; the
    // (account_id, product_id) unique violation is the one user-reachable
    // case (the existence check above rules out the FKs) → 409.
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: 'An alert for this product already exists',
        error: 'AlertAlreadyExists',
      });
    }
    throw err;
  }
}

async function updateAlert(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const alertId = parseIntParam(c, 'alertId');
  const body = await parseDto(c, updateAlertSchema);
  // Account-scoped: a foreign or absent id reports not found.
  const updated = await new D1PriceAlertRepository(c.env.DB).update(
    user.accountId,
    alertId,
    { thresholdCents: body.thresholdCents, status: body.status },
  );
  if (updated === null) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Alert "${alertId}" not found`,
      error: 'AlertNotFound',
    });
  }
  return c.json(toAlertJson(updated));
}

async function deleteAlert(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const alertId = parseIntParam(c, 'alertId');
  // Account-scoped delete; the notifications cascade at the database level.
  const deleted = await new D1PriceAlertRepository(c.env.DB).delete(
    user.accountId,
    alertId,
  );
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Alert "${alertId}" not found`,
      error: 'AlertNotFound',
    });
  }
  return c.body(null, 200);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the price-alert CRUD handlers (guards pre-registered). */
export function registerAlertsRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Rate limit composes after the session+flag guards (see module doc):
  // registration order puts guards.ts ahead of these handler chains, and
  // the account key requires the identity sessionAuth resolves.
  app.get('/api/v1/account/alerts', requireAccountRateLimit('DEFAULT'), listAlerts);
  app.post('/api/v1/account/alerts', requireAccountRateLimit('DEFAULT'), createAlert);
  app.patch(
    '/api/v1/account/alerts/:alertId',
    requireAccountRateLimit('DEFAULT'),
    updateAlert,
  );
  app.delete(
    '/api/v1/account/alerts/:alertId',
    requireAccountRateLimit('DEFAULT'),
    deleteAlert,
  );
  return app;
}

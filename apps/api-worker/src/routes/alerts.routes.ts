/**
 * Price-alert watchlist CRUD (task 2.3, change product-roadmap-phases-1-4)
 * — GET/POST/PATCH/DELETE /api/v1/account/alerts over the task-2.1
 * D1PriceAlertRepository.
 *
 * Middleware chain per request (in composition order):
 *
 *   sessionAuth() → requireAccountRateLimit('DEFAULT') → handler
 *
 * sessionAuth registers through the guards table (middleware/guards.ts —
 * route-coverage enumeration). The rate limit registers HERE, after the
 * guard, because its bucket key is the authenticated account (lead
 * decision "rate-limited per profile") — the identity must already be
 * resolved.
 *
 * Documented decisions:
 * - Threshold bounds: integer cents, 1..1_000_000 (€0.01–€10,000). The
 *   schema CHECK enforces > 0; the explicit zod max keeps absurd values
 *   out of the int column — €10,000 sits far above any tracked beverage
 *   unit price, so no legitimate alert is excluded.
 * - Alert kind (task 4.2, change trust-and-reach-roadmap; LANDED_COST +
 *   CATEGORY task 1.2, change expand-alerts-accuracy-breakdowns): the wire
 *   kind is lowercase (`price` | `tax_change` | `landed_cost` | `category`,
 *   default `price`); the D1 column stores the uppercase enum. The create
 *   matrix (design D1) is enforced in superRefine so each 400 names the
 *   offending field: the product-scoped kinds (price/tax_change/
 *   landed_cost) require a productId and forbid a category; CATEGORY
 *   requires a canonical category — an unknown one answers the search
 *   route's unknown-category 400 (one shared set, one shared phrasing) —
 *   and forbids a productId; price/landed_cost/category require a positive
 *   threshold and tax_change rejects one. Kind is part of the create
 *   identity and is NOT patchable, mirroring the repository's immutable
 *   (account, product, kind) unique index. A threshold PATCH is rejected
 *   on TAX_CHANGE rows only — the threshold kinds patch like PRICE.
 * - Duplicate (account, product, kind): 409 Conflict — the triple is
 *   guarded by a unique constraint and a second same-kind alert could
 *   only produce duplicate notifications; Conflict matches the ops-route
 *   usage of 409 for state a request cannot create. A different kind on
 *   the same product still creates (the two evaluate on different paths).
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
import type {
  PriceAlertCreate,
  PriceAlertKind,
  PriceAlertRecord,
} from '../../../../packages/data-platform/src/repositories/d1/price-alert.repository';
import {
  PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../../../../packages/data-platform/src/d1/schema';
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
    kind: row.kind,
    // CATEGORY rows carry the watched canonical category; product-scoped
    // kinds serialize null so every kind shares one response shape.
    category: row.category,
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

/**
 * Canonical-category membership — the one shared value set (design D2),
 * the same check the search route runs on its `category` parameter.
 */
function isCanonicalCategory(value: string): value is ProductCategory {
  return (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

const CATEGORY_MESSAGE = 'category must be a canonical product category string';

// Shape-only here: canonical membership is a kind-conditional rule and is
// checked in the matrix below, where the 400 can name the shared set.
const categorySchema = z.string({
  required_error: CATEGORY_MESSAGE,
  invalid_type_error: CATEGORY_MESSAGE,
});

/**
 * Wire kind — lowercase with the repository's uppercase enum mapped in
 * `toRepositoryKind`. Optional: an absent kind is the pre-kind PRICE
 * contract, byte-identical for existing clients.
 */
const KIND_MESSAGE = "kind must be one of: price, tax_change, landed_cost, category";

const kindSchema = z.enum(['price', 'tax_change', 'landed_cost', 'category'], {
  errorMap: () => ({ message: KIND_MESSAGE }),
});

function toRepositoryKind(wire: z.infer<typeof kindSchema>): PriceAlertKind {
  switch (wire) {
    case 'tax_change':
      return 'TAX_CHANGE';
    case 'landed_cost':
      return 'LANDED_COST';
    case 'category':
      return 'CATEGORY';
    default:
      return 'PRICE';
  }
}

const PRICE_REQUIRES_THRESHOLD_MESSAGE =
  'thresholdCents is required for kind "price" — without a threshold a price alert could never fire';

const LANDED_COST_REQUIRES_THRESHOLD_MESSAGE =
  'thresholdCents is required for kind "landed_cost" — without a threshold a landed-cost alert could never fire';

const CATEGORY_REQUIRES_THRESHOLD_MESSAGE =
  'thresholdCents is required for kind "category" — without a threshold a category alert could never fire';

const TAX_CHANGE_REJECTS_THRESHOLD_MESSAGE =
  'thresholdCents is not allowed for kind "tax_change" — a rate-change trigger has no threshold to compare against';

/** Required on every product-scoped kind — the watch targets one product. */
const productIdRequiredMessage = (kind: string): string =>
  `productId is required for kind "${kind}"`;

/** A category-wide watch has no product: a productId contradicts the kind. */
const CATEGORY_REJECTS_PRODUCT_MESSAGE =
  'productId is not allowed for kind "category" — the watch targets a whole canonical category, not one product';

/** A category-wide watch must name the canonical category it watches. */
const CATEGORY_REQUIRES_CATEGORY_MESSAGE =
  'category is required for kind "category" — the watch targets a canonical product category';

/** Product-scoped kinds watch one product; a category field contradicts them. */
const categoryForbiddenMessage = (kind: string): string =>
  `category is not allowed for kind "${kind}" — the watch is scoped to a single product`;

/** Search-route parity: the unknown-category 400 names the shared set. */
const unknownCategoryMessage = (value: string): string =>
  `Unknown category '${value}'. Valid categories: ${PRODUCT_CATEGORIES.join(', ')}.`;

const createAlertSchema = z
  .object({
    // Optional at the schema level because CATEGORY rows watch no product;
    // the per-kind requirement lives in the matrix below.
    productId: productIdSchema.optional(),
    category: categorySchema.optional(),
    thresholdCents: thresholdSchema.optional(),
    kind: kindSchema.optional(),
  })
  // Kind-conditional matrix (design D1): productId, category, and threshold
  // are required or forbidden per kind. superRefine (not refine) attaches
  // each issue to the offending field so the error names the key.
  .superRefine((body, ctx) => {
    const kind = body.kind ?? 'price';

    if (kind === 'category') {
      if (body.productId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: CATEGORY_REJECTS_PRODUCT_MESSAGE });
      }
    } else if (body.productId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: productIdRequiredMessage(kind) });
    }

    if (kind === 'category') {
      if (body.category === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: CATEGORY_REQUIRES_CATEGORY_MESSAGE });
      } else if (!isCanonicalCategory(body.category)) {
        // The canonical-set 400 fires HERE — before the repository guard,
        // whose raw error would render as a 500 (search-route parity).
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: unknownCategoryMessage(body.category) });
      }
    } else if (body.category !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: categoryForbiddenMessage(kind) });
    }

    if (kind === 'tax_change') {
      if (body.thresholdCents !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['thresholdCents'], message: TAX_CHANGE_REJECTS_THRESHOLD_MESSAGE });
      }
    } else if (body.thresholdCents === undefined) {
      const message =
        kind === 'landed_cost'
          ? LANDED_COST_REQUIRES_THRESHOLD_MESSAGE
          : kind === 'category'
            ? CATEGORY_REQUIRES_THRESHOLD_MESSAGE
            : PRICE_REQUIRES_THRESHOLD_MESSAGE;
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['thresholdCents'], message });
    }
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

const TAX_CHANGE_THRESHOLD_PATCH_MESSAGE =
  'thresholdCents cannot be set on a tax_change alert — the trigger is the published rate change itself, not a price level';

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
  // Kind resolves before any I/O: CATEGORY watches no product, so the
  // existence lookup below does not apply to it.
  const kind = toRepositoryKind(body.kind ?? 'price');

  // Unknown products reject before the insert (404, not an FK error).
  if (kind !== 'CATEGORY') {
    // The matrix above guarantees productId on the product-scoped kinds —
    // parseDto would have answered 400 otherwise.
    const product = await new D1ProductSearchRepository(c.env.DB).findById(
      body.productId!,
    );
    if (product === null) {
      throw new ApiHttpError(404, {
        statusCode: 404,
        message: `Product "${body.productId}" not found`,
        error: 'ProductNotFound',
      });
    }
  }

  try {
    // Each union arm is built explicitly so the compile-time shape matches
    // the repository contract (PRICE/LANDED_COST: threshold required;
    // TAX_CHANGE: none; CATEGORY: canonical category, no product). The
    // schema's matrix guarantees each arm's fields — parseDto would have
    // answered 400 otherwise.
    let createInput: PriceAlertCreate;
    switch (kind) {
      case 'TAX_CHANGE':
        createInput = {
          accountId: user.accountId,
          productId: body.productId!,
          kind: 'TAX_CHANGE',
        };
        break;
      case 'LANDED_COST':
        createInput = {
          accountId: user.accountId,
          productId: body.productId!,
          kind: 'LANDED_COST',
          thresholdCents: body.thresholdCents!,
        };
        break;
      case 'CATEGORY':
        createInput = {
          accountId: user.accountId,
          kind: 'CATEGORY',
          // The matrix checked canonical membership; the narrow type is
          // the repository contract's.
          category: body.category as ProductCategory,
          thresholdCents: body.thresholdCents!,
        };
        break;
      default:
        createInput = {
          accountId: user.accountId,
          productId: body.productId!,
          thresholdCents: body.thresholdCents!,
        };
    }
    const alert = await new D1PriceAlertRepository(c.env.DB).create(createInput);
    return c.json(toAlertJson(alert), 201);
  } catch (err) {
    // The repository deliberately surfaces raw driver errors; the
    // (account_id, product_id, kind) unique violation is the one
    // user-reachable case (the existence check above rules out the FKs)
    // → 409. The duplicate check is per product+kind: a different kind
    // on the same product is a distinct row and still creates.
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: 'An alert of this kind already exists for this product',
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
  const repo = new D1PriceAlertRepository(c.env.DB);

  // Kind is immutable (part of the create identity), so a threshold on a
  // TAX_CHANGE alert is rejected BEFORE the write — the account-scoped
  // read keeps the foreign/absent 404 semantics intact (existence never
  // leaks; the same id under another account still reports 404 here).
  if (body.thresholdCents !== undefined) {
    const owned = await repo.findByAccountId(user.accountId);
    const target = owned.find((alert) => alert.id === alertId);
    if (target === undefined) {
      throw new ApiHttpError(404, {
        statusCode: 404,
        message: `Alert "${alertId}" not found`,
        error: 'AlertNotFound',
      });
    }
    if (target.kind === 'TAX_CHANGE') {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: TAX_CHANGE_THRESHOLD_PATCH_MESSAGE,
        error: 'ValidationError',
      });
    }
  }

  // Account-scoped: a foreign or absent id reports not found.
  const updated = await repo.update(
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

/**
 * Product favorites CRUD (task 2.1, change add-product-favorites, design
 * D5) — GET/POST/DELETE /api/v1/account/favorites (DELETE /:productId)
 * over the task-1.2 D1AccountFavoritesRepository.
 *
 * Middleware chain per request (in composition order):
 *
 *   sessionAuth() → requireAccountRateLimit('DEFAULT') → handler
 *
 * sessionAuth registers through the guards table (middleware/guards.ts —
 * route-coverage enumeration). The rate limit registers HERE, after the
 * guard, because its bucket key is the authenticated account — the same
 * composition the alerts routes document (the identity must already be
 * resolved).
 *
 * Documented decisions (design D5):
 * - POST body is exactly `{ productId }` — a positive integer, the one
 *   field the create needs; a bad body answers the shared zod 400
 *   ValidationError envelope.
 * - Unknown products reject BEFORE the insert with a 404 existence check
 *   (the alerts route's precedent) — the repository leaves FK failures
 *   untranslated by contract, so the route owns the 404 and no raw
 *   driver error can render as a 500.
 * - Over-cap create: the repository-enforced cap (FAVORITES_CAP, design
 *   D3) surfaces as a 400 naming the cap, in the same style as the
 *   alerts unknown-category 400 (a descriptive message on the shared
 *   ValidationError envelope). The cap is checked before any duplicate
 *   lookup, so an over-cap account never sees the 409.
 * - Duplicate (account, product): 409 Conflict — the pair is guarded by
 *   the migration-0030 unique index and a second row could only be the
 *   same save; Conflict matches the alerts triple's usage.
 * - Ownership: every handler passes the session accountId into the
 *   repository's account-scoped queries; a foreign or absent productId
 *   matches no row and surfaces as 404 (existence never leaks across
 *   accounts). DELETE answers 204 on removal.
 *
 * @module FavoritesRoutes
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
import {
  D1AccountFavoritesRepository,
  DuplicateFavoriteError,
  FavoritesCapReachedError,
} from '../../../../packages/data-platform/src/repositories/d1/account-favorite.repository';
import type {
  AccountFavoriteListItem,
} from '../../../../packages/data-platform/src/repositories/d1/account-favorite.repository';
import { D1ProductSearchRepository } from '../../../../packages/data-platform/src/repositories/d1/product-search.repository';

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

// ---------------------------------------------------------------------------
// Serialization — ISO-8601 instants; accountId omitted (caller-scoped,
// the alerts convention); the read-model price fields carried as-is
// ---------------------------------------------------------------------------

function toFavoriteJson(row: AccountFavoriteListItem): Record<string, unknown> {
  return {
    id: row.id,
    productId: row.productId,
    savedPriceCents: row.savedPriceCents,
    // Null when the product has no fresh daily summary (design D4) —
    // and Δ only when both prices exist (computed, never stored).
    currentPriceCents: row.currentPriceCents,
    deltaCents: row.deltaCents,
    createdAt: row.createdAt.toISOString(),
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

const createFavoriteSchema = z.object({
  productId: productIdSchema,
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listFavorites(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const favorites = await new D1AccountFavoritesRepository(c.env.DB).listByAccount(
    user.accountId,
  );
  return c.json(favorites.map(toFavoriteJson));
}

async function createFavorite(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const body = await parseDto(c, createFavoriteSchema);
  const repo = new D1AccountFavoritesRepository(c.env.DB);

  // Unknown products reject before the insert (404, not an FK error) —
  // the alerts route's existence-check precedent; the repository
  // deliberately propagates the FK failure, so this check is the 404.
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

  let created: Awaited<ReturnType<typeof repo.create>>;
  try {
    created = await repo.create(user.accountId, body.productId);
  } catch (err) {
    // Cap BEFORE duplicate in the repository (design D3's risk note), so
    // this order is fixed: an over-cap account always gets the cap 400,
    // never the 409.
    if (err instanceof FavoritesCapReachedError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message:
          `Favorites cap reached: an account can save at most ${err.cap} products — ` +
          'remove one before saving more',
        error: 'ValidationError',
      });
    }
    if (err instanceof DuplicateFavoriteError) {
      throw new ApiHttpError(409, {
        statusCode: 409,
        message: 'This product is already in your favorites',
        error: 'FavoriteAlreadyExists',
      });
    }
    throw err;
  }

  // The 201 body carries the read-model fields (design D5): re-read
  // through the list model so the created row arrives with the same
  // nullable current/delta semantics GET renders — one batched,
  // cap-bounded lookup, not a per-field recompute.
  const listed = await repo.listByAccount(user.accountId);
  const row = listed.find((item) => item.id === created.id);
  return c.json(
    toFavoriteJson(
      row ?? { ...created, currentPriceCents: null, deltaCents: null },
    ),
    201,
  );
}

async function deleteFavorite(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const productId = parseIntParam(c, 'productId');
  // Account-scoped delete: a foreign or absent productId matches no row
  // and reports 404 (existence never leaks across accounts).
  const deleted = await new D1AccountFavoritesRepository(c.env.DB).delete(
    user.accountId,
    productId,
  );
  if (!deleted) {
    throw new ApiHttpError(404, {
      statusCode: 404,
      message: `Favorite for product "${productId}" not found`,
      error: 'FavoriteNotFound',
    });
  }
  return c.body(null, 204);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the favorites CRUD handlers (guards pre-registered). */
export function registerFavoritesRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Rate limit composes after the session+guards (see module doc):
  // registration order puts guards.ts ahead of these handler chains, and
  // the account key requires the identity sessionAuth resolves.
  app.get(
    '/api/v1/account/favorites',
    requireAccountRateLimit('DEFAULT'),
    listFavorites,
  );
  app.post(
    '/api/v1/account/favorites',
    requireAccountRateLimit('DEFAULT'),
    createFavorite,
  );
  app.delete(
    '/api/v1/account/favorites/:productId',
    requireAccountRateLimit('DEFAULT'),
    deleteFavorite,
  );
  return app;
}

/**
 * Account preferences (task 2.1, change add-onboarding-preferences,
 * design D2/D6/D7/D8) — GET/PUT/DELETE /api/v1/account/preferences over
 * the task-1.2 D1AccountPreferencesRepository. The /onboarding quiz's
 * persistence surface, doubling as the preferences editor (design D6).
 *
 * Middleware chain per request (in composition order):
 *
 *   sessionAuth() → requireAccountRateLimit('DEFAULT') → handler
 *
 * sessionAuth registers through the guards table (middleware/guards.ts —
 * route-coverage enumeration). The rate limit registers HERE, after the
 * guard, because its bucket key is the authenticated account — the same
 * composition the alerts and favorites routes document (the identity
 * must already be resolved).
 *
 * Documented decisions (design D2/D6/D7/D8):
 * - GET answers the stored row, or the unanswered shape when the account
 *   has never written one (the repository materializes a row on first
 *   real write only — data minimization). accountId is caller-scoped
 *   and never serialized (the alerts convention).
 * - PUT is a SPARSE patch (design D2): every field optional, unspecified
 *   fields retained. `channel: null` explicitly clears the answer back
 *   to unanswered (design D8); the empty categoryTags array is valid and
 *   means "follows no category" (design D7). A PUT of only
 *   `{ digestEnabled: true }` therefore retains channel/tags.
 * - Onboarding completion rides the wire contract as the `onboarded`
 *   boolean (design D6): the route translates `onboarded: true` into
 *   onboardedAt = now. The Date itself is never client-writable, and
 *   `false`/absent never unsets a recorded completion — onboardedAt is
 *   set by quiz completion or explicit skip, nothing else.
 * - PUT validates the contract twice: zod first (messages naming the
 *   closed sets — the alerts kind/unknown-category message style), then
 *   the repository's UnknownCategoryTagError/InvalidChannelError mapped
 *   to the shared 400 ValidationError envelope (the
 *   FavoritesCapReachedError convention — no raw driver error can ever
 *   render as a 500).
 * - DELETE is the repository reset: UPDATE, never DELETE — the row (and
 *   its id/created_at) survives, only the answers clear. It answers 200
 *   with the reset shape, and is idempotent: an account without a row
 *   gets the unanswered shape without materializing one.
 *
 * @module PreferencesRoutes
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { requireAccountRateLimit } from '../middleware/rate-limit';
import { parseDto } from './support';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';
import type { AuthenticatedAccount } from '../auth/authenticated-account';
import {
  D1AccountPreferencesRepository,
  InvalidChannelError,
  UnknownCategoryTagError,
  ACCOUNT_CHANNELS,
} from '../../../../packages/data-platform/src/repositories/d1/account-preference.repository';
import type {
  AccountPreferencesPatch,
  AccountPreferencesRecord,
  AccountPreferencesView,
} from '../../../../packages/data-platform/src/repositories/d1/account-preference.repository';
import {
  PRODUCT_CATEGORIES,
} from '../../../../packages/data-platform/src/d1/schema';

function requireUser(c: Context<AppEnv>): AuthenticatedAccount {
  return c.get(USER_CONTEXT_KEY) as AuthenticatedAccount;
}

// ---------------------------------------------------------------------------
// Serialization — ISO-8601 instants; accountId omitted (caller-scoped,
// the alerts convention)
// ---------------------------------------------------------------------------

function toPreferencesJson(view: AccountPreferencesView): Record<string, unknown> {
  return {
    channel: view.channel,
    categoryTags: [...view.categoryTags],
    digestEnabled: view.digestEnabled,
    onboardedAt: view.onboardedAt === null ? null : view.onboardedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Validation — closed sets from the shared constants (design D7/D8),
// optional-everywhere because PUT is a sparse patch (design D2)
// ---------------------------------------------------------------------------

const CHANNEL_MESSAGE =
  'channel must be one of: TRAVEL, DELIVERY, BOTH (or null to clear the answer)';

const channelSchema = z.enum(ACCOUNT_CHANNELS, {
  errorMap: () => ({ message: CHANNEL_MESSAGE }),
});

const CATEGORY_TAG_MESSAGE =
  'categoryTags must be an array of canonical product category keys';

const categoryTagsSchema = z.array(
  z.enum(PRODUCT_CATEGORIES, { errorMap: () => ({ message: CATEGORY_TAG_MESSAGE }) }),
  {
    required_error: CATEGORY_TAG_MESSAGE,
    invalid_type_error: CATEGORY_TAG_MESSAGE,
  },
);

const DIGEST_MESSAGE = 'digestEnabled must be a boolean';

const digestEnabledSchema = z.boolean({
  required_error: DIGEST_MESSAGE,
  invalid_type_error: DIGEST_MESSAGE,
});

const ONBOARDED_MESSAGE = 'onboarded must be a boolean';

const onboardedSchema = z.boolean({
  required_error: ONBOARDED_MESSAGE,
  invalid_type_error: ONBOARDED_MESSAGE,
});

const putPreferencesSchema = z.object({
  channel: channelSchema.nullable().optional(),
  categoryTags: categoryTagsSchema.optional(),
  digestEnabled: digestEnabledSchema.optional(),
  // Wire-level translation seam (design D6): see putPreferences.
  onboarded: onboardedSchema.optional(),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function getPreferences(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const view = await new D1AccountPreferencesRepository(c.env.DB).getByAccount(
    user.accountId,
  );
  return c.json(toPreferencesJson(view));
}

async function putPreferences(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  const body = await parseDto(c, putPreferencesSchema);

  // Sparse patch (design D2): only the present fields reach the
  // repository — absent means retained, not cleared.
  const patch: AccountPreferencesPatch = {
    ...(body.channel !== undefined && { channel: body.channel }),
    ...(body.categoryTags !== undefined && { categoryTags: body.categoryTags }),
    ...(body.digestEnabled !== undefined && { digestEnabled: body.digestEnabled }),
    // D6 translation: the client answers a boolean; the route owns the
    // instant. Only `true` sets onboardedAt — false/absent never unsets.
    ...(body.onboarded === true && { onboardedAt: new Date() }),
  };

  let saved: AccountPreferencesRecord;
  try {
    saved = await new D1AccountPreferencesRepository(c.env.DB).put(
      user.accountId,
      patch,
    );
  } catch (err) {
    // The repository is the contract authority for the closed sets
    // (design D7/D8); a domain rejection surfaces as the shared 400
    // ValidationError envelope naming the offending value, never a raw
    // 500 (the FavoritesCapReachedError convention).
    if (err instanceof UnknownCategoryTagError || err instanceof InvalidChannelError) {
      throw new ApiHttpError(400, {
        statusCode: 400,
        message: err.message,
        error: 'ValidationError',
      });
    }
    throw err;
  }

  return c.json(toPreferencesJson(saved));
}

async function deletePreferences(c: Context<AppEnv>): Promise<Response> {
  const user = requireUser(c);
  // Reset, not erase: the repository UPDATEs the unanswered shape over
  // the row (id/created_at preserved) and answers the unanswered shape
  // for an account that never wrote one.
  const reset = await new D1AccountPreferencesRepository(c.env.DB).reset(
    user.accountId,
  );
  return c.json(toPreferencesJson(reset));
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the preferences handlers (guards pre-registered). */
export function registerPreferencesRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
  // Rate limit composes after the session+guards (see module doc):
  // registration order puts guards.ts ahead of these handler chains, and
  // the account key requires the identity sessionAuth resolves.
  app.get(
    '/api/v1/account/preferences',
    requireAccountRateLimit('DEFAULT'),
    getPreferences,
  );
  app.put(
    '/api/v1/account/preferences',
    requireAccountRateLimit('DEFAULT'),
    putPreferences,
  );
  app.delete(
    '/api/v1/account/preferences',
    requireAccountRateLimit('DEFAULT'),
    deletePreferences,
  );
  return app;
}

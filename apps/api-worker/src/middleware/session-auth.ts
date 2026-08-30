/**
 * SessionAuthMiddleware — Hono port of SessionAuthGuard
 * (packages/application-api/src/accounts/session-auth.guard.ts, task 2.2,
 * change technical-assessment-remediation; design D3; Worker port task 3.2).
 *
 * Authentication resolves EXCLUSIVELY from the opaque session token in the
 * `rajahinta_session` httpOnly cookie, looked up by its SHA-256 hash against
 * the D1 `sessions` table (see src/auth/session-resolver.ts). The account is
 * derived server-side only and attached to the context for downstream
 * consumers (`c.get('user')`, handlers via c.set/`c.get('sessionToken')`).
 *
 * The retired `x-user-id` header is rejected outright, in every form: the
 * header value WAS the identity under the old model, so accepting it —
 * even as a hint, even alongside a valid token — keeps the impersonation
 * vector alive. There is no compatibility mode (the API is pre-launch and
 * the assessment calls for the header to die).
 *
 * Every rejection is a 401 (not 403): the presented credential is not
 * recognized at all. Error payloads match the Nest guard byte-for-byte and
 * ride the unified envelope (src/errors.ts).
 *
 * @module session-auth
 */

import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { resolveAccountByToken } from '../auth/session-resolver';
import { USER_CONTEXT_KEY, SESSION_TOKEN_CONTEXT_KEY } from '../auth/authenticated-account';

/** Cookie carrying the opaque session token (httpOnly, SameSite=Lax). */
export const SESSION_COOKIE_NAME = 'rajahinta_session';

/** True when the request carries a non-empty `x-user-id` header value. */
function hasLegacyUserIdHeader(c: { req: { header(name: string): string | undefined } }): boolean {
  const value = c.req.header('x-user-id');
  return value !== undefined && value.trim().length > 0;
}

/**
 * Authentication middleware: resolves the account from the session cookie
 * or rejects with the exact 401 envelope of the Nest guard. The D1 lookup
 * runs against `env.DB` per request (vars are static per isolate, so the
 * resolution path is stable — the Worker equivalent of the guard's
 * construction-time configuration).
 */
export function sessionAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (hasLegacyUserIdHeader(c)) {
      // Outright rejection, no compat mode — see module doc.
      throw new ApiHttpError(401, {
        statusCode: 401,
        message:
          'The x-user-id header is no longer accepted. Authenticate with ' +
          `the ${SESSION_COOKIE_NAME} cookie issued by POST /api/v1/account/session.`,
        error: 'LegacyUserIdHeaderRejected',
      });
    }

    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (token === undefined || token.length === 0) {
      throw new ApiHttpError(401, {
        statusCode: 401,
        message: 'Authentication required: no session cookie presented.',
        error: 'SessionRequired',
      });
    }

    const account = await resolveAccountByToken(c.env.DB, token);
    if (account === null) {
      // Unknown, expired, revoked, or rotated-away token — indistinguishable
      // by design; a guessed token never grants anything.
      throw new ApiHttpError(401, {
        statusCode: 401,
        message: 'Session token is invalid, expired, or revoked.',
        error: 'InvalidSession',
      });
    }

    // Attach the server-derived identity for downstream consumers
    // (handlers via c.get('user'), EntitlementMiddleware via the context).
    c.set(USER_CONTEXT_KEY, account);
    // The raw token stays on the context for rotate/revoke handlers.
    c.set(SESSION_TOKEN_CONTEXT_KEY, token);

    await next();
  };
}

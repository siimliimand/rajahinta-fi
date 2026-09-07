/**
 * Authenticated-account request context (task 2.2, change
 * technical-assessment-remediation; design D3).
 *
 * `SessionAuthGuard` resolves the account exclusively from the presented
 * session token and attaches this object to `request.user`. Controllers
 * read it through the {@link CurrentUser} parameter decorator — identity is
 * derived server-side only, never from a client-supplied header.
 *
 * @module current-user
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { EntitlementTier } from '@rajahinta/core-domain';

/**
 * The authenticated account for a request.
 *
 * No email-verification state is carried here: credentials auth and the
 * verified-email state live only in the API Worker (design D9, change
 * email-password-auth); the legacy harness deliberately excludes them.
 */
export interface AuthenticatedAccount {
  /** Numeric account row id — links sessions, baskets, and scenarios. */
  readonly accountId: number;
  /** Stable external identifier (server-generated for anonymous sessions). */
  readonly userId: string;
  /** Tier from the account row — EntitlementService resolves from this. */
  readonly tier: EntitlementTier;
}

/** Property on the Nest request object holding the raw presented token. */
export const SESSION_TOKEN_REQUEST_KEY = 'sessionToken';

/**
 * Controller parameter decorator yielding the {@link AuthenticatedAccount}
 * attached by `SessionAuthGuard`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAccount => {
    const request = ctx.switchToHttp().getRequest<{
      user?: AuthenticatedAccount;
    }>();
    if (!request.user) {
      throw new Error(
        'CurrentUser used without SessionAuthGuard on the route',
      );
    }
    return request.user;
  },
);

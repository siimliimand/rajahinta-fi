/**
 * SessionAuthGuard — token-derived authentication (task 2.2, change
 * technical-assessment-remediation; design D3).
 *
 * Authentication resolves EXCLUSIVELY from the opaque session token in the
 * `rajahinta_session` httpOnly cookie, looked up by its SHA-256 hash via
 * {@link SessionTokenService}. The account is derived server-side only.
 *
 * The retired `x-user-id` header is rejected outright, in every form: the
 * header value WAS the identity under the old model, so accepting it —
 * even as a hint, even alongside a valid token — keeps the impersonation
 * vector alive. There is no compatibility mode (the API is pre-launch and
 * the assessment calls for the header to die).
 *
 * @module SessionAuthGuard
 */

import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionTokenService } from './session-token.service';
import {
  SESSION_COOKIE_NAME,
  extractSessionToken,
} from './session-cookie';
import { isAccountVerified } from './email-verification';
import type { AuthenticatedAccount } from './current-user.decorator';

/** Known tier values as stored on the account row. */
const KNOWN_TIERS = new Set(['FREE', 'PREMIUM', 'PROFESSIONAL']);

/** True when the request carries a non-empty `x-user-id` header value. */
function hasLegacyUserIdHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): boolean {
  const value = headers?.['x-user-id'];
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessionTokens: SessionTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      cookies?: Record<string, string | undefined>;
      user?: AuthenticatedAccount;
      sessionToken?: string;
    }>();

    if (hasLegacyUserIdHeader(request.headers)) {
      // Outright rejection, no compat mode — see module doc. 401 (not 403):
      // the presented credential scheme is not recognised at all.
      throw new UnauthorizedException({
        statusCode: 401,
        message:
          'The x-user-id header is no longer accepted. Authenticate with ' +
          `the ${SESSION_COOKIE_NAME} cookie issued by POST /api/v1/account/session.`,
        error: 'LegacyUserIdHeaderRejected',
      });
    }

    const token = extractSessionToken(request);
    if (token === undefined) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Authentication required: no session cookie presented.',
        error: 'SessionRequired',
      });
    }

    const account = await this.sessionTokens.resolveAccountByToken(token);
    if (account === null) {
      // Unknown, expired, revoked, or rotated-away token — indistinguishable
      // by design; a guessed token never grants anything.
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Session token is invalid, expired, or revoked.',
        error: 'InvalidSession',
      });
    }

    // Attach the server-derived identity for downstream consumers
    // (controllers via @CurrentUser, EntitlementGuard via request.user).
    request.user = {
      accountId: account.id,
      userId: account.userId,
      tier: KNOWN_TIERS.has(account.tier) ? (account.tier as AuthenticatedAccount['tier']) : 'FREE',
      verified: isAccountVerified(account.email),
    };
    // The raw token stays on the request for rotate/revoke handlers.
    request.sessionToken = token;

    return true;
  }
}

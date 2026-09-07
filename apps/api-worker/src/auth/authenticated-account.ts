/**
 * Authenticated-account request context — Workers port of
 * packages/application-api/src/accounts/current-user.decorator.ts
 * (task 2.2, change technical-assessment-remediation; design D3), kept in
 * sync with `EntitlementTier` from core-domain.
 *
 * `SessionAuthMiddleware` (task 3.2) resolves the account exclusively from
 * the presented session token and attaches this object to the Hono context
 * (`c.get('user')`) — identity is derived server-side only, never from a
 * client-supplied header. The interface is duplicated rather than imported
 * because the Nest source file lives behind `@nestjs/common` and
 * `@rajahinta/core-domain` package specifiers the Worker cannot resolve;
 * the shape is pinned by parity tests.
 *
 * @module authenticated-account
 */

/**
 * Access tiers — mirror of core-domain `EntitlementTier` (ordering and
 * semantics live in core-domain's entitlement engine; the Worker only
 * carries the union).
 */
export type EntitlementTier = 'FREE' | 'PREMIUM' | 'PROFESSIONAL';

/**
 * The authenticated account for a request.
 *
 * `verified` reflects email-verification state (change email-password-auth,
 * task 2.4): the account row's `email_verified_at` is set only by the
 * emailed single-use token flow, and a verified email protects the account
 * row. Sessions exist only for accounts created through register/login —
 * no anonymous identity is minted anywhere.
 */
export interface AuthenticatedAccount {
  /** Numeric account row id — links sessions, baskets, and scenarios. */
  readonly accountId: number;
  /** Stable external identifier (server-generated at registration). */
  readonly userId: string;
  /** Tier from the account row — EntitlementService resolves from this. */
  readonly tier: EntitlementTier;
  /** Whether the account's email is verified (`email_verified_at` IS NOT NULL). */
  readonly verified: boolean;
}

/** Hono context variable holding the raw presented token (rotate/revoke handlers). */
export const SESSION_TOKEN_CONTEXT_KEY = 'sessionToken';

/** Hono context variable holding the {@link AuthenticatedAccount}. */
export const USER_CONTEXT_KEY = 'user';

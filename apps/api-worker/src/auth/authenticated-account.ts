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
 * `verified` reflects the email-verification groundwork (task 2.4): an
 * anonymous account carries a placeholder email and its data is disposable
 * by design; a verified email on the account row marks it as protected.
 */
export interface AuthenticatedAccount {
  /** Numeric account row id — links sessions, baskets, and scenarios. */
  readonly accountId: number;
  /** Stable external identifier (server-generated for anonymous sessions). */
  readonly userId: string;
  /** Tier from the account row — EntitlementService resolves from this. */
  readonly tier: EntitlementTier;
  /** Whether the account's email column holds a verified (non-placeholder) address. */
  readonly verified: boolean;
}

/** Hono context variable holding the raw presented token (rotate/revoke handlers). */
export const SESSION_TOKEN_CONTEXT_KEY = 'sessionToken';

/** Hono context variable holding the {@link AuthenticatedAccount}. */
export const USER_CONTEXT_KEY = 'user';

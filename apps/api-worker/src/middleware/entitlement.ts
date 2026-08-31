/**
 * EntitlementMiddleware — Hono port of EntitlementGuard
 * (packages/application-api/src/entitlement/entitlement.guard.ts; Worker
 * port task 3.2).
 *
 * Usage (the Nest `@UseGuards(EntitlementGuard)` + `@RequireFeature(f)`
 * pair collapses into one registration — metadata becomes the argument):
 *
 * ```typescript
 * app.get('/api/v1/declaration/:recordId', requireFeature('declaration:summary'), handler);
 * ```
 *
 * Reads the account context from `c.get('user')` (attached by the session
 * auth middleware — SessionAuthGuard on session-authenticated routes). A
 * user object carrying `tier` resolves from the account record; a bare
 * `{ id }` legacy shape degrades to the userId string (Phase 1 PREMIUM
 * default), and no user means anonymous (FREE tier). Denied access throws
 * a 403 with the tier information.
 *
 * @module entitlement
 */

import type { MiddlewareHandler } from 'hono';
import { EntitlementService } from '../../../../packages/core-domain/src/entitlement/entitlement.service';
import type {
  AccountContext,
  FeatureId,
} from '../../../../packages/core-domain/src/entitlement/entitlement.types';
import type { AppEnv } from '../env';
import { ApiHttpError } from '../errors';
import { USER_CONTEXT_KEY } from '../auth/authenticated-account';

/** The injected entitlement engine — framework-free core-domain service. */
export function createEntitlementService(): EntitlementService {
  return new EntitlementService();
}

/**
 * Normalize the attached auth context to what EntitlementService accepts:
 * a tier-bearing object becomes an AccountContext (tier from the account
 * record), a legacy `{ id }` shape stays a bare userId string, anything
 * else is anonymous. Verbatim port of the guard's toAccountContext.
 */
export function toAccountContext(
  user: unknown,
): AccountContext | string | null {
  if (user === null || user === undefined) return null;
  if (typeof user === 'string') return user;

  const candidate = user as { id?: unknown; userId?: unknown; tier?: unknown };
  const hasTier = typeof candidate.tier === 'string' && candidate.tier.length > 0;
  if (!hasTier) {
    return typeof candidate.id === 'string' ? candidate.id : null;
  }

  const userId =
    typeof candidate.userId === 'string' ? candidate.userId : candidate.id;
  return typeof userId === 'string'
    ? { userId, tier: candidate.tier as AccountContext['tier'] }
    : null;
}

/**
 * Entitlement middleware for one feature: checks feature access before
 * allowing a request to proceed, with the guard's exact 403 payload
 * (`InsufficientEntitlement` + requiredTier/currentTier).
 */
export function requireFeature(feature: FeatureId): MiddlewareHandler<AppEnv> {
  return (c, next) => {
    const entitlement = createEntitlementService();
    const account = toAccountContext(c.get(USER_CONTEXT_KEY));

    const result = entitlement.checkAccess(account, feature);

    if (result.allowed) {
      return next();
    }

    throw new ApiHttpError(403, {
      statusCode: 403,
      message: result.reason ?? 'Access denied',
      error: 'InsufficientEntitlement',
      requiredTier: feature,
      currentTier: result.tier,
    });
  };
}

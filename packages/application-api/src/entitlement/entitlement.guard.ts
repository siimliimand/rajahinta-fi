/**
 * EntitlementGuard — NestJS guard that enforces feature-access tier.
 *
 * Usage:
 * ```typescript
 * @UseGuards(EntitlementGuard)
 * @RequireFeature('declaration:summary')
 * @Get(':recordId')
 * async premiumEndpoint() { … }
 * ```
 *
 * Returns HTTP 403 with the tier information when access is denied.
 *
 * @module EntitlementGuard
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  EntitlementService,
  type AccountContext,
  type FeatureId,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Metadata key and decorator
// ---------------------------------------------------------------------------

export const REQUIRE_FEATURE_KEY = 'require_feature';

/**
 * Decorator that sets the required feature for a route.
 *
 * @example
 * ```typescript
 * @RequireFeature('declaration:summary')
 * @Get(':recordId')
 * async getDeclaration() { … }
 * ```
 */
export const RequireFeature = (feature: FeatureId) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Entitlement guard that checks feature access before allowing a
 * request to proceed.
 *
 * Reads the account context from `request.user` (attached by the auth
 * guard — `SessionAuthGuard` on session-authenticated routes). A user
 * object carrying `tier` is passed through as an {@link AccountContext}
 * so tiers resolve from the account record; a bare `{ id }` legacy shape
 * degrades to the userId string (Phase 1 PREMIUM default), and no user
 * means anonymous (FREE tier).
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlement: EntitlementService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<FeatureId>(
      REQUIRE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No feature requirement — allow
    if (feature === undefined || feature === null) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: unknown = (request as { user?: unknown }).user;

    const account = this.toAccountContext(user);

    const result = this.entitlement.checkAccess(account, feature);

    if (result.allowed) {
      return true;
    }

    throw new ForbiddenException({
      statusCode: 403,
      message: result.reason ?? 'Access denied',
      error: 'InsufficientEntitlement',
      requiredTier: feature,
      currentTier: result.tier,
    });
  }

  /**
   * Normalize the attached auth context to what EntitlementService accepts:
   * a tier-bearing object becomes an AccountContext (tier from the account
   * record), a legacy `{ id }` shape stays a bare userId string, anything
   * else is anonymous.
   */
  private toAccountContext(user: unknown): AccountContext | string | null {
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
}
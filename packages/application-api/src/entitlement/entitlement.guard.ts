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
import { EntitlementService, FeatureId } from '@rajahinta/core-domain';

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
 * Extracts user ID from `request.user?.id` (set by an auth middleware
 * or passport strategy).  When no user is present, `userId` is `null`
 * and the FREE tier applies.
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
    const userId: string | null = (request as any).user?.id ?? null;

    const result = this.entitlement.checkAccess(userId, feature);

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
}
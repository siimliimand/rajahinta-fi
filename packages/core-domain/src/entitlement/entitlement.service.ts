/**
 * EntitlementService — feature-access entitlement checks.
 *
 * In-memory for Phase 1.  Replace with a subscription-management
 * backend or API-key service in production.
 *
 * Default: anonymous users (userId === null) are FREE tier.
 * Premium features require a non-null userId with an override
 * environment variable for development.
 *
 * @module EntitlementService
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  Entitlement,
  EntitlementTier,
  FeatureId,
  FEATURE_TIER_MAP,
  isTierSufficient,
} from './entitlement.types';

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  /**
   * Check whether a user has access to the given feature.
   *
   * @param userId — the user's identifier, or `null` for anonymous requests
   * @param feature — the feature being requested
   */
  checkAccess(userId: string | null, feature: FeatureId): Entitlement {
    const requiredTier = FEATURE_TIER_MAP[feature];

    // Anonymous users default to FREE tier
    if (userId === null) {
      const allowed = requiredTier === 'FREE';
      return {
        allowed,
        tier: 'FREE',
        reason: allowed
          ? undefined
          : `Feature "${feature}" requires ${requiredTier} tier. Sign in or upgrade.`,
      };
    }

    // Phase 1: all authenticated users are PREMIUM tier by default.
    // Override via ENTITLEMENT_TIER env var for testing.
    const userTier = this.resolveUserTier(userId);

    const allowed = isTierSufficient(userTier, requiredTier);
    return {
      allowed,
      tier: userTier,
      reason: allowed
        ? undefined
        : `Feature "${feature}" requires ${requiredTier} tier. Current tier: ${userTier}.`,
    };
  }

  /**
   * Resolve the tier for a known user.
   *
   * Phase 1: all authenticated users get PREMIUM tier, overridable
   * per-user via `ENTITLEMENT_TIER_<userId>` env var, or globally
   * via `ENTITLEMENT_DEFAULT_TIER`.
   */
  private resolveUserTier(userId: string): EntitlementTier {
    // Per-user override
    const perUserVar = `ENTITLEMENT_TIER_${userId.toUpperCase()}`;
    const perUserOverride = process.env[perUserVar];
    if (perUserOverride !== undefined) {
      const tier = this.parseTier(perUserOverride);
      if (tier !== null) return tier;
    }

    // Global default for authenticated users
    const globalDefault = process.env['ENTITLEMENT_DEFAULT_TIER'];
    if (globalDefault !== undefined) {
      const tier = this.parseTier(globalDefault);
      if (tier !== null) return tier;
    }

    return 'PREMIUM';
  }

  /**
   * Parse a tier string, returning null on invalid input.
   */
  private parseTier(raw: string): EntitlementTier | null {
    const upper = raw.toUpperCase().trim();
    if (upper === 'PREMIUM') return 'PREMIUM';
    if (upper === 'PROFESSIONAL') return 'PROFESSIONAL';
    if (upper === 'FREE') return 'FREE';
    this.logger.warn(`Invalid entitlement tier in env: "${raw}"`);
    return null;
  }
}
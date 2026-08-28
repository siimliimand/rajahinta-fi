/**
 * EntitlementService — feature-access entitlement checks.
 *
 * Tier resolution (technical-assessment finding 14):
 * - The tier comes from the account record (`accounts.tier`), passed in as
 *   an {@link AccountContext} by the API layer.
 * - `ENTITLEMENT_DEFAULT_TIER` remains ONLY as a global testing override:
 *   honored in non-production environments and applied uniformly to every
 *   account. Per-user env-var overrides are removed — tier state belongs to
 *   the account record, not the process environment.
 *
 * @module EntitlementService
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  AccountContext,
  Entitlement,
  EntitlementTier,
  FeatureId,
  FEATURE_TIER_MAP,
  isTierSufficient,
} from './entitlement.types';

/** Environment variable holding the global, test-only tier override. */
const GLOBAL_TEST_TIER_OVERRIDE_ENV = 'ENTITLEMENT_DEFAULT_TIER';

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);

  /**
   * Check whether the caller has access to the given feature.
   *
   * @param account — the account context carrying the tier from
   *                  `accounts.tier`. A bare userId string is accepted from
   *                  callers that have not fetched the account record yet;
   *                  it resolves to the Phase 1 PREMIUM default until the
   *                  session wiring passes full contexts. `null` = anonymous.
   * @param feature — the feature being requested
   */
  checkAccess(
    account: AccountContext | string | null,
    feature: FeatureId,
  ): Entitlement {
    const requiredTier = FEATURE_TIER_MAP[feature];

    // Anonymous requests are FREE tier
    if (account === null) {
      const allowed = requiredTier === 'FREE';
      return {
        allowed,
        tier: 'FREE',
        reason: allowed
          ? undefined
          : `Feature "${feature}" requires ${requiredTier} tier. Sign in or upgrade.`,
      };
    }

    const userTier = this.resolveTier(account);

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
   * Resolve the tier for a known account.
   *
   * Precedence: global test override (non-production only, uniform), then
   * the account record's tier. Legacy bare-userId callers keep the Phase 1
   * PREMIUM default until every caller passes an {@link AccountContext}.
   */
  private resolveTier(account: AccountContext | string): EntitlementTier {
    const override = this.globalTestOverride();
    if (override !== null) return override;

    if (typeof account === 'string') {
      return 'PREMIUM';
    }
    return account.tier;
  }

  /**
   * Global test override from `ENTITLEMENT_DEFAULT_TIER`.
   *
   * Refused in production so a stray env var can never rewrite real tiers;
   * applied uniformly (never keyed on user identifiers) per the
   * subscription-billing spec.
   */
  private globalTestOverride(): EntitlementTier | null {
    if (process.env.NODE_ENV === 'production') return null;

    const raw = process.env[GLOBAL_TEST_TIER_OVERRIDE_ENV];
    if (raw === undefined) return null;
    return this.parseTier(raw);
  }

  /**
   * Parse a tier string, returning null on invalid input.
   */
  private parseTier(raw: string): EntitlementTier | null {
    const upper = raw.toUpperCase().trim();
    if (upper === 'PREMIUM') return 'PREMIUM';
    if (upper === 'PROFESSIONAL') return 'PROFESSIONAL';
    if (upper === 'FREE') return 'FREE';
    this.logger.warn(
      `Invalid entitlement tier in env ${GLOBAL_TEST_TIER_OVERRIDE_ENV}: "${raw}"`,
    );
    return null;
  }
}

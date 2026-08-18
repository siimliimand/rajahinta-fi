/**
 * BillingService — subscription billing integration.
 *
 * **Phase 2 Deferral (explicit):** Third-party subscription billing integration
 * (Stripe or equivalent) is explicitly deferred to Phase 2. The service interface
 * remains stable. Phase 1 uses simulated responses only.
 * See `docs/tasks.md` task T1.56 — marked as deferred to Phase 2.
 *
 * The three-tier plan maps to `EntitlementTier` from core-domain:
 *   - FREE         — basic product browsing and landed-cost calculations
 *   - PREMIUM      — €4.99/month — detailed breakdowns, history, CSV export
 *   - PROFESSIONAL — future — API access, batch calculations, priority support
 *
 * @module BillingService
 */

import { Injectable, Logger } from '@nestjs/common';

// Re-use the existing EntitlementTier type for plan values
import type { EntitlementTier } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Active subscription status for a user.
 */
export interface SubscriptionStatus {
  /** The user's unique identifier. */
  readonly userId: string;
  /** The plan the user is subscribed to. */
  readonly plan: EntitlementTier;
  /** Whether the subscription is currently active. */
  readonly active: boolean;
  /** End of the current billing period (set for paid plans). */
  readonly currentPeriodEnd?: Date;
  /** True if the subscription is set to cancel at period end. */
  readonly cancelAtPeriodEnd?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Simulated billing service — Phase 1 placeholder.
 *
 * In Phase 2, replace the implementations with real Stripe (or equivalent)
 * provider calls. The method signatures remain stable.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  /**
   * Retrieve the current subscription status for a user.
   *
   * Phase 1: returns a simulated FREE-tier status for all users.
   */
  async getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
    this.logger.debug(`getSubscriptionStatus called for userId=${userId}`);

    return {
      userId,
      plan: 'FREE',
      active: true,
    };
  }

  /**
   * Create a Stripe Checkout Session (or equivalent) for the given plan.
   *
   * Phase 1: returns a mock checkout URL.
   *
   * @param plan - The plan to subscribe to.
   * @returns An object containing the redirect URL for the checkout flow.
   */
  async createCheckoutSession(
    plan: EntitlementTier,
  ): Promise<{ checkoutUrl: string }> {
    this.logger.debug(`createCheckoutSession called for plan=${plan}`);

    // Phase 1: mock URL — real provider integration in Phase 2
    return {
      checkoutUrl: `https://checkout.example.com/session/mock-${plan.toLowerCase()}-${Date.now()}`,
    };
  }

  /**
   * Handle an incoming webhook from the billing provider.
   *
   * Phase 1: logs the payload without processing.
   *
   * @param payload - Raw webhook payload from the billing provider.
   */
  async handleWebhook(payload: unknown): Promise<void> {
    this.logger.log('Webhook received (Phase 1 — no processing)');
    this.logger.debug(`Payload: ${JSON.stringify(payload)}`);
  }
}
/**
 * Account types for the minimal account system.
 *
 * ## Design constraints
 *
 * - Phase 1: minimal fields for saved baskets, calculation history,
 *   and subscription management. No personal data beyond email.
 * - The account is NOT required to view public product comparisons.
 *
 * @module AccountTypes
 */

import type { EntitlementTier } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Basket
// ---------------------------------------------------------------------------

/** A single item in a saved basket. */
export interface BasketItem {
  readonly productId: number;
  readonly productName: string;
  readonly quantity: number;
}

/** A saved product selection (basket). */
export interface Basket {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly items: BasketItem[];
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/** Phase 1 subscription status — inline to avoid coupling to billing module. */
export interface SubscriptionStatus {
  readonly userId: string;
  readonly plan: EntitlementTier;
  readonly active: boolean;
  readonly currentPeriodEnd?: Date;
  readonly cancelAtPeriodEnd?: boolean;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

/**
 * Phase 1 minimal account.
 *
 * ## Privacy assertion
 *
 * This interface intentionally contains NO date-of-birth, identity document,
 * national ID number, or any other personally-identifying field beyond
 * `email`. The age gate uses a simple frontend confirmation (no DOB, no
 * documents) — see AgeGate component and SimpleConfirmationProvider.
 *
 * If a future legal review mandates stronger identity verification, that
 * must be added as a separate isolated subsystem (see ARCHITECTURE.md
 * "Minimal personal data" constraint), NOT merged into this interface.
 *
 * Fields:
 * - `userId` — unique identifier
 * - `email` — user's email address
 * - `tier` — 'FREE' | 'PREMIUM' (Phase 1 always FREE by default)
 * - `savedBaskets` — user's saved product selections
 * - `calculationHistory` — IDs of past calculations
 * - `subscription` — current subscription status
 * - `createdAt` — when the account was created (for retention policies)
 * - `lastActiveAt` — when the user last interacted (for inactivity-based retention)
 */
export interface Account {
  readonly userId: string;
  readonly email: string;
  readonly tier: 'FREE' | 'PREMIUM';
  readonly savedBaskets: Basket[];
  readonly calculationHistory: number[];
  readonly subscription: SubscriptionStatus;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
}
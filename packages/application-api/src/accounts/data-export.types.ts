/**
 * DataExport — GDPR data-portability types.
 *
 * Represents all user data that can be exported on request.
 * Phase 1: JSON format. CSV export is planned for Phase 2.
 *
 * ## Privacy notice
 *
 * The export contains all personal data the system holds for the user
 * (email address, saved baskets, saved scenarios, calculation history).
 * This is the user's own data — the export exists to support the user's
 * right of access under GDPR Article 15.
 *
 * No other user's data is included in the export.
 *
 * @module DataExport
 */

import type { Basket, SavedScenario, SubscriptionStatus } from './account.types';

/**
 * A single calculation from the user's history.
 *
 * Phase 1: lightweight record stub.  A production export would include
 * the full calculation result with cost breakdown, tax rates applied,
 * and disclaimer.
 */
export interface CalculationExportRecord {
  readonly calculationId: number;
  readonly timestamp: Date;
  readonly totalCents: number;
  readonly productName: string;
  readonly quantity: number;
}

/**
 * Complete data export payload for a single user.
 *
 * Returned by {@link DataExportService.exportUserData} and served
 * via the GET /api/v1/account/export endpoint.
 */
export interface DataExport {
  /** The user whose data is being exported. */
  readonly userId: string;
  /** ISO 8601 timestamp of when the export was generated. */
  readonly exportDate: string;
  /** The user's account details. */
  readonly account: {
    readonly userId: string;
    readonly email: string;
    readonly tier: string;
    readonly createdAt: string;
    readonly lastActiveAt: string;
  };
  /** Saved baskets. */
  readonly savedBaskets: Basket[];
  /** Saved scenarios — account data per the saved-scenarios spec lifecycle. */
  readonly savedScenarios: SavedScenario[];
  /** Calculation history. */
  readonly calculationHistory: CalculationExportRecord[];
  /** Current subscription status. */
  readonly subscription: SubscriptionStatus;
}
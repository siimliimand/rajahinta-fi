/**
 * AccountRetentionService — data retention and automated deletion/anonymization.
 *
 * Implements the retention policy defined by legal/compliance:
 *
 * | Data category              | Retention window | Action                     |
 * |----------------------------|------------------|----------------------------|
 * | Account (inactive)         | 12 months        | Permanent deletion         |
 * | Calculation history        | 24 months        | Deletion of old records    |
 * | Analytics / telemetry      | 12 months        | Anonymization after expiry |
 * | Account (inactive > 6 mo)  | 6 months         | Anonymization              |
 *
 * Phase 1: operates on the in-memory AccountService store. In production,
 * this service would issue SQL queries against the persisted account tables
 * and schedule recurring jobs via a task scheduler.
 *
 * @module AccountRetentionService
 */

import { Injectable, Logger } from '@nestjs/common';
import { AccountService } from './account.service';

// ---------------------------------------------------------------------------
// Retention configuration (milliseconds)
// ---------------------------------------------------------------------------

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

export const RETENTION_CONFIG = {
  /**
   * Accounts inactive for this duration are permanently deleted.
   * 12 months = 12 * 30 days.
   */
  accountInactivityDeleteMs: 12 * MS_PER_MONTH,

  /**
   * Accounts inactive for this duration are anonymized (PII removed,
   * non-personal data retained).
   * 6 months = 6 * 30 days.
   */
  accountInactivityAnonymizeMs: 6 * MS_PER_MONTH,

  /**
   * Calculation history entries older than this are deleted.
   * 24 months = 24 * 30 days.
   */
  calculationHistoryRetentionMs: 24 * MS_PER_MONTH,

  /**
   * Analytics/telemetry data older than this is anonymized.
   * 12 months = 12 * 30 days.
   */
  analyticsRetentionMs: 12 * MS_PER_MONTH,
} as const;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PurgeResult {
  /** Number of accounts permanently deleted. */
  readonly deletedCount: number;
  /** User IDs of deleted accounts. */
  readonly deletedUserIds: string[];
}

export interface AnonymizeResult {
  /** Number of accounts anonymized. */
  readonly anonymizedCount: number;
  /** User IDs of anonymized accounts. */
  readonly anonymizedUserIds: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AccountRetentionService {
  private readonly logger = new Logger(AccountRetentionService.name);

  constructor(private readonly accountService: AccountService) {}

  /**
   * Purge accounts that have been inactive longer than the configured
   * retention window (default: 12 months).
   *
   * Phase 1: iterates the in-memory Map via `getAllUserIds()`. A
   * production implementation would use a SQL query:
   *
   * ```sql
   * DELETE FROM accounts WHERE last_active_at < now() - interval '12 months';
   * ```
   */
  async purgeExpiredAccounts(): Promise<PurgeResult> {
    const cutoff = new Date(Date.now() - RETENTION_CONFIG.accountInactivityDeleteMs);
    const deletedUserIds: string[] = [];

    const userIds = await this.accountService.getAllUserIds();

    for (const userId of userIds) {
      const account = await this.accountService.getAccount(userId);
      if (account.lastActiveAt < cutoff) {
        await this.accountService.deleteAccount(userId);
        deletedUserIds.push(userId);
      }
    }

    this.logger.log(
      `Retention purge: ${deletedUserIds.length} account(s) deleted (inactive before ${cutoff.toISOString()})`,
    );

    return {
      deletedCount: deletedUserIds.length,
      deletedUserIds,
    };
  }

  /**
   * Purge calculation history older than the configured retention window
   * (default: 24 months) for a given user.
   *
   * Phase 1: clears the in-memory array. A production implementation
   * would DELETE from the calculation_records table.
   *
   * @param userId — the user whose calculation history to purge
   */
  async purgeCalculationHistory(userId: string): Promise<void> {
    // Phase 1: calculationHistory is a number[] of record IDs.
    // Without dates on each entry, we purge all history (simulated).
    // A production implementation would DELETE FROM calculation_records
    // WHERE user_id = $1 AND calculated_at < now() - interval '24 months'.
    const account = await this.accountService.getAccount(userId);
    const mutable = account as { calculationHistory: number[] };
    mutable.calculationHistory = [];
    this.logger.debug(
      `Calculation history purged for userId="${userId}" (Phase 1: full clear)`,
    );
  }

  /**
   * Anonymize accounts that have been inactive longer than the
   * anonymization threshold (default: 6 months) but shorter than
   * the deletion threshold (12 months).
   *
   * Anonymization replaces identifiable fields (email, userId) with
   * anonymized values. Saved account data — baskets and scenarios —
   * is deleted by the anonymize cascade (see
   * {@link AccountService.anonymizeAccount}); only the non-personal
   * account skeleton is retained. Retention therefore covers saved
   * scenarios through this path with no scenario-specific logic here.
   */
  async anonymizeInactiveAccounts(): Promise<AnonymizeResult> {
    const deleteCutoff = new Date(Date.now() - RETENTION_CONFIG.accountInactivityDeleteMs);
    const anonymizeCutoff = new Date(Date.now() - RETENTION_CONFIG.accountInactivityAnonymizeMs);
    const anonymizedUserIds: string[] = [];

    const userIds = await this.accountService.getAllUserIds();

    for (const userId of userIds) {
      const account = await this.accountService.getAccount(userId);

      // Only anonymize accounts inactive > 6 months BUT still active enough
      // (< 12 months) to not have been purged yet.
      if (account.lastActiveAt < anonymizeCutoff && account.lastActiveAt >= deleteCutoff) {
        await this.accountService.anonymizeAccount(userId);
        anonymizedUserIds.push(userId);
      }
    }

    this.logger.log(
      `Retention anonymize: ${anonymizedUserIds.length} account(s) anonymized`,
    );

    return {
      anonymizedCount: anonymizedUserIds.length,
      anonymizedUserIds,
    };
  }
}
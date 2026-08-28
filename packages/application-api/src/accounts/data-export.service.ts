/**
 * DataExportService — user-requested data export for GDPR data portability.
 *
 * Aggregates all user data held by the system into a single JSON payload
 * that can be downloaded by the user.  Supports the right of access
 * (Article 15 GDPR) and data portability (Article 20 GDPR).
 *
 * Phase 1: JSON format (CSV planned for Phase 2). Calculation history
 * is sourced through {@link AccountService}: on the repository path it is
 * the account's claimed calculation records (real timestamps, totals,
 * product names); the in-memory fallback synthesizes stubs from the
 * record ID list.
 *
 * ## Usage
 *
 * ```typescript
 * const exportData = await dataExportService.exportUserData(userId);
 * // Return as JSON download to the user
 * ```
 *
 * @module DataExportService
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccountService } from './account.service';
import type { DataExport, CalculationExportRecord } from './data-export.types';

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(private readonly accountService: AccountService) {}

  /**
   * Export all data held for the given user.
   *
   * @param userId — the user whose data to export
   * @returns A {@link DataExport} payload with all user data
   * @throws NotFoundException if the user has no account
   */
  async exportUserData(userId: string): Promise<DataExport> {
    let account;
    try {
      account = await this.accountService.getAccount(userId);
    } catch {
      throw new NotFoundException(`User "${userId}" not found`);
    }

    // Calculation history comes from the claimed calculation records on
    // the DB path (real timestamps, totals, product names) and from the
    // account's ID list on the in-memory fallback — sourced through the
    // service either way, same lifecycle as saved baskets/scenarios.
    const calculationHistory: CalculationExportRecord[] =
      await this.accountService.getCalculationHistoryForExport(userId);

    // Saved baskets are loaded separately from the account row on the
    // repository path (rowToAccount never populates them), so source them
    // through the service — same lifecycle as saved scenarios.
    const savedBaskets = await this.accountService.getSavedBaskets(userId);

    // Saved scenarios are account data (saved-scenarios spec) and follow
    // the same export lifecycle as saved baskets.
    const savedScenarios = await this.accountService.getScenarios(userId);

    const exportData: DataExport = {
      userId: account.userId,
      exportDate: new Date().toISOString(),
      account: {
        userId: account.userId,
        email: account.email,
        tier: account.tier,
        createdAt: account.createdAt.toISOString(),
        lastActiveAt: account.lastActiveAt.toISOString(),
      },
      savedBaskets,
      savedScenarios,
      calculationHistory,
      subscription: account.subscription,
    };

    this.logger.debug(
      `Data export generated for userId="${userId}" ` +
        `(${exportData.savedBaskets.length} baskets, ` +
        `${exportData.savedScenarios.length} scenarios, ` +
        `${exportData.calculationHistory.length} calculations)`,
    );

    return exportData;
  }
}
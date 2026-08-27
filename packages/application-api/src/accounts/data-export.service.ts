/**
 * DataExportService — user-requested data export for GDPR data portability.
 *
 * Aggregates all user data held by the system into a single JSON payload
 * that can be downloaded by the user.  Supports the right of access
 * (Article 15 GDPR) and data portability (Article 20 GDPR).
 *
 * Phase 1: operates on the in-memory AccountService store. Calculation
 * history is simulated from the record ID list.  A production implementation
 * would query the calculation_records table and include full cost breakdowns.
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

    // Build calculation history from the ID list
    const calculationHistory: CalculationExportRecord[] =
      account.calculationHistory.map((id, index) => ({
        calculationId: id,
        // Phase 1: synthetic timestamp — production would query the record table
        timestamp: new Date(Date.now() - index * 86400000),
        totalCents: 0,
        productName: `calculation-${id}`,
        quantity: 1,
      }));

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
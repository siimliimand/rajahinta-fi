/**
 * AccountModule — minimal account management.
 *
 * Provides {@link AccountService}, {@link AccountRetentionService},
 * {@link DataExportService}, and {@link AccountController} for
 * dependency injection.
 *
 * @module AccountModule
 */

import { Module } from '@nestjs/common';
import { DataPlatformModule } from '@rajahinta/data-platform';
import { AccountService } from './account.service';
import { AccountRetentionService } from './account-retention.service';
import { DataExportService } from './data-export.service';
import { AccountController } from './account.controller';
import { SessionTokenService } from './session-token.service';

@Module({
  imports: [DataPlatformModule],
  controllers: [AccountController],
  providers: [
    AccountService,
    AccountRetentionService,
    DataExportService,
    // Server-issued opaque session tokens (task 2.1, change
    // technical-assessment-remediation). SessionRepository and
    // AccountRepository resolve from DataPlatformModule. The auth-guard
    // migration onto these tokens is task 2.2.
    SessionTokenService,
  ],
  exports: [
    AccountService,
    AccountRetentionService,
    DataExportService,
    SessionTokenService,
  ],
})
export class AccountModule {}

export { AccountService } from './account.service';
export { AccountRetentionService } from './account-retention.service';
export type { PurgeResult, AnonymizeResult } from './account-retention.service';
export { DataExportService } from './data-export.service';
export type { DataExport, CalculationExportRecord } from './data-export.types';
export type { Account, Basket, BasketItem, SubscriptionStatus, SavedScenario, SaveScenarioRequest } from './account.types';
export { SessionTokenService } from './session-token.service';
export type { IssuedSession } from './session-token.service';
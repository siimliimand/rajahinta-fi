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
import { AccountService } from './account.service';
import { AccountRetentionService } from './account-retention.service';
import { DataExportService } from './data-export.service';
import { AccountController } from './account.controller';

@Module({
  controllers: [AccountController],
  providers: [
    AccountService,
    AccountRetentionService,
    DataExportService,
  ],
  exports: [
    AccountService,
    AccountRetentionService,
    DataExportService,
  ],
})
export class AccountModule {}

export { AccountService } from './account.service';
export { AccountRetentionService } from './account-retention.service';
export type { PurgeResult, AnonymizeResult } from './account-retention.service';
export { DataExportService } from './data-export.service';
export type { DataExport, CalculationExportRecord } from './data-export.types';
export type { Account, Basket, BasketItem, SubscriptionStatus } from './account.types';
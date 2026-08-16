/**
 * AccountModule — minimal account management.
 *
 * Provides {@link AccountService} for dependency injection.
 *
 * @module AccountModule
 */

import { Module } from '@nestjs/common';
import { AccountService } from './account.service';

@Module({
  providers: [AccountService],
  exports: [AccountService],
})
export class AccountModule {}

export { AccountService } from './account.service';
export type { Account, Basket, BasketItem, SubscriptionStatus } from './account.types';
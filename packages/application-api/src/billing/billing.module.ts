/**
 * BillingModule — subscription billing integration.
 *
 * Registers BillingService as a provider.  Structurally separate from other
 * modules (ranking, calculator, etc.) as required by 14.2.
 *
 * @module BillingModule
 */

import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';

@Module({
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}

export { BillingService } from './billing.service';
export type { SubscriptionStatus } from './billing.service';
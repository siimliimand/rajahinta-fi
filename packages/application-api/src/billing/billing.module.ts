/**
 * BillingModule — subscription billing integration.
 *
 * ## Isolation guarantee
 *
 * This module is **structurally isolated** from the Ranking & Sorting
 * Module (`RankingModule` in `@rajahinta/core-domain`):
 *
 * - It does **not** import `RankingModule`, `RankingService`, `NeutralSortInput`,
 *   `SortOrder`, or any other ranking type at the source level.
 * - It does **not** reference ranking module paths in its `@Module()` decorator.
 * - Its public API (`BillingService`, `SubscriptionStatus`) contains no method
 *   or type that can influence product sort position.
 * - A merchant account (if ever introduced) **cannot** purchase better placement
 *   because no code path exists from billing to ranking inputs.
 *
 * This separation is enforced by:
 *   1. The TypeScript compiler (type incompatibility between billing and ranking types).
 *   2. Static import analysis in `billing-ranking-isolation.test.ts`.
 *   3. Runtime write-path audit (same test file).
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
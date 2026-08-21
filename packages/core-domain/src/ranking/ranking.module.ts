/**
 * Ranking Module.
 *
 * Registers the RankingService for injection into composition roots
 * and downstream consumers (API layer, comparison views).
 *
 * ## Isolation guarantee
 *
 * This module is **structurally isolated** from the billing module
 * (`BillingModule` in `@rajahinta/application-api`):
 *
 * - It does **not** import `BillingModule`, `BillingService`, `SubscriptionStatus`,
 *   or any other billing type at the source level.
 * - Its `@Module()` decorator declares zero billing-related imports.
 * - Its public API (`RankingService`, `NeutralSortInput`, `SortOrder`) accepts
 *   **only** objective, factual product data. No billing or merchant-related
 *   fields exist in any ranking type.
 * - A merchant account (if ever introduced) **cannot** purchase better placement
 *   because `RankingService.rank()` structurally rejects any input with extra
 *   properties (runtime guard) and the type system enforces the same at compile
 *   time.
 *
 * This separation is enforced by:
 *   1. The TypeScript compiler (type incompatibility between billing and ranking types).
 *   2. Static import analysis in `billing-ranking-isolation.test.ts`.
 *   3. Runtime guard in `RankingService.rank()` rejecting unknown properties.
 *
 * @module RankingModule
 */
import { Module } from '@nestjs/common';
import { RankingService } from './ranking.service';
import { RankingConfigService } from './ranking-config.service';

@Module({
  providers: [RankingService, RankingConfigService],
  exports: [RankingService, RankingConfigService],
})
export class RankingModule {}
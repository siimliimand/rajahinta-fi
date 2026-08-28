/**
 * AnalyticsModule — lightweight click analytics.
 *
 * Controllers record against {@link RedisClickAnalyticsService} (durable
 * Redis counters, task 4.3 / design D8), provided by the global AuditModule
 * so counts are shared across replicas and survive rollouts. The in-memory
 * {@link ClickAnalyticsService} stays bound here for tests only — it is not
 * used on any production path.
 *
 * ## Phase 1 constraints
 *
 * - No purchase tracking, no commission data.
 * - The module exports `ClickAnalyticsService` so test setups (and any
 *   future reporting service reading accumulated data in-process) can bind
 *   the in-memory double.
 *
 * @module AnalyticsModule
 */

import { Module } from '@nestjs/common';
import { ClickAnalyticsService } from './click-analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  // OutboundRedirectController stays registered at the ApplicationApiModule
  // composition root (it was never owned by this module).
  controllers: [AnalyticsController],
  // RedisClickAnalyticsService resolves from the @Global AuditModule — no
  // import needed here, and importing it would not duplicate the provider.
  providers: [ClickAnalyticsService],
  exports: [ClickAnalyticsService],
})
export class AnalyticsModule {}

export { ClickAnalyticsService } from './click-analytics.service';

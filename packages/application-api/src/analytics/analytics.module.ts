/**
 * AnalyticsModule — lightweight click analytics for Phase 1.
 *
 * Provides {@link ClickAnalyticsService} (in-memory) and
 * {@link AnalyticsController} (POST /api/v1/analytics/click).
 *
 * ## Phase 1 constraints
 *
 * - No database — all data is held in memory.
 * - No purchase tracking, no commission data.
 * - The module exports `ClickAnalyticsService` so other modules
 *   (e.g. a future reporting service) can read accumulated data.
 *
 * @module AnalyticsModule
 */

import { Module } from '@nestjs/common';
import { ClickAnalyticsService } from './click-analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [ClickAnalyticsService],
  exports: [ClickAnalyticsService],
})
export class AnalyticsModule {}

export { ClickAnalyticsService } from './click-analytics.service';
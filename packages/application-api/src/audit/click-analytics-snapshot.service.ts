/**
 * ClickAnalyticsSnapshotService — periodic archival of the Redis click
 * counters into PostgreSQL (task 4.3, change
 * technical-assessment-remediation).
 *
 * Runs on a cron so snapshots happen even with no traffic. Each run
 * captures one instant: every (merchant, URL) cumulative count becomes
 * one row keyed by (merchant, url, capturedAt) — re-running the same
 * instant converges instead of duplicating. Redis remains the live
 * store; these rows are the durable history that survives a Redis
 * flush or migration.
 *
 * @module ClickAnalyticsSnapshotService
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ClickCounterSnapshotRepository,
} from '@rajahinta/data-platform';
import { RedisClickAnalyticsService } from './redis-click-analytics.service';

@Injectable()
export class ClickAnalyticsSnapshotService {
  private readonly logger = new Logger(ClickAnalyticsSnapshotService.name);

  constructor(
    private readonly clickAnalytics: RedisClickAnalyticsService,
    private readonly snapshotRepository: ClickCounterSnapshotRepository,
  ) {}

  /** Every 6 hours — frequent enough that a Redis flush loses at most one window. */
  @Cron('0 */6 * * *')
  async snapshotNow(at: Date = new Date()): Promise<number> {
    const counts = await this.clickAnalytics.getClickCounts();
    const rows = Object.entries(counts).flatMap(([merchantId, perUrl]) =>
      Object.entries(perUrl).map(([url, clickCount]) => ({
        merchantId,
        url,
        clickCount,
        capturedAt: at,
      })),
    );

    if (rows.length === 0) {
      this.logger.log('Click-counter snapshot: nothing to archive');
      return 0;
    }

    const written = await this.snapshotRepository.appendBatch(rows);
    this.logger.log(
      `Click-counter snapshot: ${written} row(s) archived at ${at.toISOString()}`,
    );
    return written;
  }
}

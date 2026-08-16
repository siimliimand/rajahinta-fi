/**
 * RateReviewSchedulerService — periodic check for newly published official
 * tax-rate changes.
 *
 * Each check scans configured sources (mock-only in this version; actual
 * API integrations are merchant-specific).  When new rates are detected,
 * a manual-review entry is created.  Rates are NEVER auto-published —
 * they only go live after manual/legal confirmation.
 *
 * The scheduler interface is lightweight (no cron dependency) so consumers
 * can drive it from a BullMQ worker, a NestJS @Cron decorator, or an
 * external scheduler.
 *
 * @module RateReviewSchedulerService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import type { RateReviewResult, RateReviewEntry } from '../interfaces/rate-review.types';
import type { IRateReviewRepository } from '../interfaces/rate-review-repository.port';
import { RATE_REVIEW_REPOSITORY_PORT } from '../interfaces/rate-review-repository.port';

/**
 * Configuration for the rate-review scheduler.
 *
 * Injection token so callers can override defaults per environment
 * (e.g. shorter intervals in test, disabled in dev).
 */
export const RATE_REVIEW_CONFIG_TOKEN = 'RATE_REVIEW_CONFIG_TOKEN';

export interface RateReviewConfig {
  /** Interval between scheduled checks in milliseconds. Default 86_400_000 (24h). */
  readonly checkIntervalMs: number;
  /**
   * When true, checkForRateChanges() always reports no new rates.
   * Useful for staging/demo environments where external sources are not
   * available.  Default false.
   */
  readonly discoveryDisabled: boolean;
}

export const DEFAULT_RATE_REVIEW_CONFIG: RateReviewConfig = {
  checkIntervalMs: 86_400_000,
  discoveryDisabled: false,
};

@Injectable()
export class RateReviewSchedulerService {
  private readonly logger = new Logger(RateReviewSchedulerService.name);
  /** Active timer handle, set by scheduleNextReview(). */
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(RATE_REVIEW_REPOSITORY_PORT)
    private readonly repository: IRateReviewRepository,
    @Inject(RATE_REVIEW_CONFIG_TOKEN)
    private readonly config: RateReviewConfig,
  ) {}

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  /**
   * Schedule the next periodic rate review.
   *
   * Idempotent: calling multiple times clears the previous timer and sets a
   * new one.  Pass `checkIntervalMs` through config to control frequency.
   *
   * In production, this is typically called once at bootstrap by a
   * BullMQ worker or an {@code onModuleInit} hook in the owning module.
   */
  scheduleNextReview(): void {
    this.clearTimer();

    this.timerHandle = setInterval(() => {
      this.checkForRateChanges()
        .then((result) => {
          if (result.newRatesDetected) {
            this.logger.warn(
              `New rates detected (reviewId=${result.reviewId}) — ` +
                'manual confirmation required before any dataset goes live',
            );
          } else {
            this.logger.log('No new rate changes detected');
          }
        })
        .catch((err: unknown) => {
          this.logger.error('Rate review check failed', err instanceof Error ? err.message : String(err));
        });
    }, this.config.checkIntervalMs);

    this.logger.log(
      `Rate review scheduled every ${this.config.checkIntervalMs} ms`,
    );
  }

  // ---------------------------------------------------------------------------
  // Rate-change check
  // ---------------------------------------------------------------------------

  /**
   * Check for newly published official rate changes.
   *
   * In the current version this is a mock / simulated check.  When
   * `discoveryDisabled` is true (e.g. in test environments), the method
   * always returns "no new rates".  Otherwise it returns a deterministic
   * result (newRatesDetected=false) that tests can override via DI.
   *
   * Actual API integrations (vero.fi, EUR-Lex, etc.) will replace this
   * method body in a future iteration.
   *
   * Rates are NEVER auto-published.
   */
  async checkForRateChanges(): Promise<RateReviewResult> {
    const checkedAt = new Date().toISOString();

    if (this.config.discoveryDisabled) {
      return { checkedAt, newRatesDetected: false };
    }

    // -----------------------------------------------------------------------
    // Mock implementation — replace with real source integration later.
    // Currently always returns "no new rates" so the scheduler runs silently
    // until real API adapters are wired.
    // -----------------------------------------------------------------------
    const newRatesDetected = false;

    if (!newRatesDetected) {
      return { checkedAt, newRatesDetected: false };
    }

    // When real detection lands, the code below creates a review entry.
    return {
      checkedAt,
      newRatesDetected: true,
    };
  }

  // ---------------------------------------------------------------------------
  // Review task creation
  // ---------------------------------------------------------------------------

  /**
   * Create a manual-review entry for a detected rate change.
   *
   * The entry is persisted via the repository port so operators can
   * inspect, approve, or reject the change before any dataset goes live.
   *
   * @param reviewResult — The result from {@link checkForRateChanges} that
   *   triggered this task.  Must have {@code newRatesDetected: true}.
   * @returns The created review entry.
   * @throws When {@code reviewResult.newRatesDetected} is false (no-op guard).
   */
  async createRateUpdateTask(reviewResult: RateReviewResult): Promise<RateReviewEntry> {
    if (!reviewResult.newRatesDetected) {
      throw new Error(
        'Cannot create rate-update task when newRatesDetected is false',
      );
    }

    const id = reviewResult.reviewId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const entry: RateReviewEntry = {
      id,
      createdAt: now,
      description: 'New official tax rates detected — manual review required before publishing',
      source: 'vero.fi (simulated check)',
      status: 'pending',
    };

    await this.repository.create(entry);

    this.logger.log(`Rate-update review entry created: ${id}`);

    return entry;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Cancel the active timer if one is running. */
  stopReviews(): void {
    this.clearTimer();
    this.logger.log('Rate review scheduler stopped');
  }

  /** Clear the interval timer. */
  private clearTimer(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
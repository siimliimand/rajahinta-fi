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
import type { IRateReviewRepository, RateChangeSourcePort } from '../interfaces/rate-review-repository.port';
import { RATE_REVIEW_REPOSITORY_PORT, RATE_CHANGE_SOURCE_PORT } from '../interfaces/rate-review-repository.port';

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

// ---------------------------------------------------------------------------
// Rate-change source — config-backed default implementation
// ---------------------------------------------------------------------------

/** Injection token for the rate-change source configuration (snapshot path). */
export const RATE_CHANGE_SOURCE_CONFIG_TOKEN = 'RATE_CHANGE_SOURCE_CONFIG_TOKEN';

/** Default: empty string means "not configured" — no detection. */
export const DEFAULT_RATE_CHANGE_SOURCE_CONFIG = '';

/**
 * Config-backed default implementation of {@link RateChangeSourcePort}.
 *
 * Reads a configured snapshot path/URL. When the path is empty (the default),
 * returns no new rates — preserving the Phase 1 no-op behaviour.
 */
@Injectable()
export class ConfigBackedRateChangeSource implements RateChangeSourcePort {
  constructor(
    @Inject(RATE_CHANGE_SOURCE_CONFIG_TOKEN)
    private readonly snapshotPath: string,
  ) {}

  async checkForChanges(): Promise<RateReviewResult> {
    const checkedAt = new Date().toISOString();

    if (!this.snapshotPath) {
      // No snapshot source configured — no detection possible.
      return { checkedAt, newRatesDetected: false };
    }

    // Phase 1: snapshot path is configured but we still return no changes.
    // Real implementation would read the snapshot file/URL and compare
    // against the last-known rate set.
    return { checkedAt, newRatesDetected: false };
  }
}

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
    @Inject(RATE_CHANGE_SOURCE_PORT)
    private readonly rateChangeSource: RateChangeSourcePort,
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
   * Phase 1: Rate-change detection is intentionally a documented no-op.
   * Real API integration (vero.fi tax rate API, EUR-Lex legislative changes)
   * is deferred until a dedicated adapter layer with proper error handling,
   * rate limiting, and scheduled polling is designed. See docs/tasks.md T1.23.
   *
   * When `discoveryDisabled` is true (e.g. in test environments), the method
   * always returns "no new rates".  Otherwise it also returns a deterministic
   * result (newRatesDetected=false) that tests can override via DI.
   *
   * Rates are NEVER auto-published.
   */
  async checkForRateChanges(): Promise<RateReviewResult> {
    const checkedAt = new Date().toISOString();

    if (this.config.discoveryDisabled) {
      return { checkedAt, newRatesDetected: false };
    }

    // Delegate to the injected rate-change source port.
    // Phase 1 default: ConfigBackedRateChangeSource returns no new rates
    // when no snapshot path is configured (preserving the documented no-op).
    const result = await this.rateChangeSource.checkForChanges();

    // When real detection returns true, the caller (scheduleNextReview)
    // logs a warning and expects an operator to call createRateUpdateTask.
    // Rates are NEVER auto-published.
    return result;
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
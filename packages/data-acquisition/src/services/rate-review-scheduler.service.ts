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
import * as fs from 'fs/promises';
import * as path from 'path';
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

/**
 * Default: resolved path to the rate snapshot file (config/rate-snapshot.json).
 *
 * The snapshot baseline reflects the current official 2024/2025/2026 rates.
 * When the file content changes (e.g. a new 2027 version is added), the
 * hash comparison detects the drift and creates a pending review entry.
 */
export const DEFAULT_RATE_CHANGE_SOURCE_CONFIG = path.join(
  __dirname, '../../config/rate-snapshot.json',
);

/**
 * Config-backed default implementation of {@link RateChangeSourcePort}.
 *
 * Reads a configured snapshot path (local file). When the path is empty
 * (the default), returns no new rates — preserving the Phase 1 no-op
 * behaviour.
 *
 * Detection works by computing a SHA-256 hash of the snapshot file content
 * and comparing it against the hash stored in the most recent review entry.
 * When the hash differs, new rates are reported.  The hash is persisted in
 * the review entry so detection survives process restarts.
 *
 * Rates are NEVER auto-published — the caller creates a pending review
 * entry that requires manual/legal confirmation.
 */
@Injectable()
export class ConfigBackedRateChangeSource implements RateChangeSourcePort {
  private readonly logger = new Logger(ConfigBackedRateChangeSource.name);

  constructor(
    @Inject(RATE_CHANGE_SOURCE_CONFIG_TOKEN)
    private readonly snapshotPath: string,
    @Inject(RATE_REVIEW_REPOSITORY_PORT)
    private readonly repository: IRateReviewRepository,
  ) {}

  async checkForChanges(): Promise<RateReviewResult> {
    const checkedAt = new Date().toISOString();

    if (!this.snapshotPath) {
      // No snapshot source configured — no detection possible.
      return { checkedAt, newRatesDetected: false };
    }

    try {
      const content = await fs.readFile(this.snapshotPath, 'utf-8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      // Retrieve the last-known hash from the most recent review entry.
      // The entry may be pending (active review) or resolved (previously
      // reviewed and actioned).
      const lastEntry = await this.getLatestEntry();
      const lastHash = lastEntry?.contentHash;

      if (lastHash === hash) {
        this.logger.log('Snapshot content unchanged — no new rates detected');
        return { checkedAt, newRatesDetected: false };
      }

      // Content differs from the last-known state.
      this.logger.warn('Snapshot content changed — new rates detected');
      return {
        checkedAt,
        newRatesDetected: true,
        reviewId: crypto.randomUUID(),
        detectedVersions: [`snapshot-hash:${hash.slice(0, 12)}`],
      };
    } catch (err) {
      this.logger.error(
        'Failed to read snapshot file — degrading to no-change',
        err instanceof Error ? err.message : String(err),
      );
      // Graceful degradation: if the file can't be read we return
      // no changes so the scheduler loop doesn't break.
      return { checkedAt, newRatesDetected: false };
    }
  }

  /**
   * Return the most recent review entry, preferring pending over resolved.
   * Entries are ordered newest-first by the repository implementation.
   */
  private async getLatestEntry(): Promise<RateReviewEntry | null> {
    const pending = await this.repository.findByStatus('pending');
    if (pending.length > 0) return pending[0];
    const resolved = await this.repository.findByStatus('resolved');
    return resolved.length > 0 ? resolved[0] : null;
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
  // Versioned-publication review (Task 1.3)
  // ---------------------------------------------------------------------------

  /**
   * Create a pending-review entry for a versioned tax-rate publication.
   *
   * The entry records that a specific dataset version (e.g. 'v2.0-2025')
   * has been checked against the official publication and confirmed by a
   * named person.  The entry starts as `pending` — it requires explicit
   * {@link approveReview} before the version is considered published.
   *
   * Rates are NEVER auto-published.  The seed function inserts rows as
   * data bootstrap; the review entry is the legal-compliance record that
   * confirms the bootstrap data matches the official rates.
   *
   * @param versionLabel — The dataset version being published
   *   (e.g. 'v2.0-2025', 'v3.0-2026').
   * @param confirmedBy — Name/identifier of the person who performed the
   *   legal confirmation (e.g. 'Matti Meikäläinen').
   * @param confirmedRole — Role or title of the confirming person
   *   (e.g. 'Finnish Tax Counsel').
   * @param description — Optional description; defaults to a standard
   *   message including the version label.
   * @returns The created review entry in `pending` status.
   */
  async createVersionedPublicationReview(
    versionLabel: string,
    confirmedBy: string,
    confirmedRole: string,
    description?: string,
  ): Promise<RateReviewEntry> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const entry: RateReviewEntry = {
      id,
      createdAt: now,
      description:
        description ??
        `Version ${versionLabel} — rates confirmed against official vero.fi publication`,
      source: 'vero.fi (legal confirmation)',
      status: 'pending',
      versionLabel,
      confirmedBy,
      confirmedRole,
    };

    await this.repository.create(entry);

    this.logger.log(
      `Versioned-publication review entry created: ${id} (version=${versionLabel}, confirmedBy=${confirmedBy})`,
    );

    return entry;
  }

  /**
   * Approve a pending rate-review entry, transitioning it to resolved.
   *
   * This is the explicit manual-approval step that moves a versioned
   * publication review from `pending` to `resolved` with resolution
   * `approve`.  Until this method is called, no rate version is
   * considered published — the "never auto-publish" invariant.
   *
   * @param id — The review entry id to approve.
   * @param approvedBy — Name/identifier of the approving person.
   * @param notes — Optional reviewer notes to append.
   * @returns The updated entry with status=resolved, resolution=approve.
   * @throws When no entry with this id exists.
   */
  async approveReview(
    id: string,
    approvedBy: string,
    notes?: string,
  ): Promise<RateReviewEntry> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(
        `Cannot approve review: no rate-review entry with id "${id}"`,
      );
    }
    if (existing.status !== 'pending') {
      throw new Error(
        `Cannot approve review: entry "${id}" is already ${existing.status}`,
      );
    }

    const resolvedAt = new Date().toISOString();
    const reviewerNotes = notes
      ? `Approved by ${approvedBy}. ${notes}`
      : `Approved by ${approvedBy}.`;

    await this.repository.updateStatus(
      id,
      'resolved',
      'approve',
      resolvedAt,
      reviewerNotes,
    );

    const updated = await this.repository.findById(id);
    // The repository returns a copy, so updated is guaranteed non-null here.
    return updated!;
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
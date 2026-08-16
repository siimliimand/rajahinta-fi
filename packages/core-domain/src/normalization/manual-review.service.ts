/**
 * ManualReviewService — queue for human review of low-confidence product matches.
 *
 * When the product matching engine cannot assign HIGH or EXACT confidence, the
 * match result is enqueued here so a human operator can review the candidates
 * and decide how to proceed.
 *
 * The service depends on IManualReviewRepository (a port) so the persistence
 * adapter can be swapped without changing domain logic.
 *
 * @module ManualReviewService
 */

import { Inject, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  PendingReview,
  ReviewResolution,
} from './manual-review.types';
import type { ProductMatchResult } from './product-matcher.types';
import type { NormalizedProduct } from './normalization.types';
import type { IManualReviewRepository } from './ports/manual-review-repository.port';
import { MANUAL_REVIEW_REPOSITORY_PORT } from './ports/manual-review-repository.port';

@Injectable()
export class ManualReviewService {
  constructor(
    @Inject(MANUAL_REVIEW_REPOSITORY_PORT)
    private readonly repository: IManualReviewRepository,
  ) {}

  /**
   * Enqueue a normalised product and its match result for manual review.
   *
   * A new PendingReview entry is created with a random id, the raw input
   * preserved from the NormalizedProduct, and all candidates the engine
   * considered. Returns the created entry.
   *
   * This is idempotent-safe: if the caller enqueues the same product
   * multiple times, each call creates a separate review entry.
   */
  async enqueueForReview(
    normalized: NormalizedProduct,
    matchResult: ProductMatchResult,
  ): Promise<PendingReview> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const entry: PendingReview = {
      id,
      rawProduct: { ...normalized.originalInput },
      matchCandidates: [...matchResult.candidates],
      engineConfidence: matchResult.confidence,
      status: 'pending',
      createdAt: now,
    };

    await this.repository.create(entry);
    return entry;
  }

  /**
   * Resolve a pending-review entry with the operator's decision.
   *
   * - `accept`: the operator confirms the engine's best candidate.
   * - `reject`: the operator disagrees; the product needs re-matching or
   *   a new product master record.
   * - `new_product`: the raw input represents a product not yet in the
   *   product master; a new record should be created.
   *
   * Throws when the entry does not exist or is already resolved.
   */
  async resolveReview(
    reviewId: string,
    resolution: ReviewResolution,
  ): Promise<void> {
    const entry = await this.repository.findById(reviewId);

    if (!entry) {
      throw new Error(
        `Cannot resolve review ${reviewId}: entry not found`,
      );
    }

    if (entry.status === 'resolved') {
      throw new Error(
        `Cannot resolve review ${reviewId}: already resolved with "${entry.resolution}"`,
      );
    }

    const now = new Date().toISOString();
    await this.repository.updateStatus(reviewId, 'resolved', resolution, now);
  }

  /**
   * Return all pending (unresolved) review entries, newest first.
   */
  async listPending(): Promise<PendingReview[]> {
    return this.repository.findByStatus('pending');
  }
}
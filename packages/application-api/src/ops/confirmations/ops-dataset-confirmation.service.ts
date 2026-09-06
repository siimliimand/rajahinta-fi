/**
 * OpsDatasetConfirmationService — console workflow for tax-rate
 * dataset-version confirmation (task 12.1, change
 * technical-assessment-remediation; design D2).
 *
 * The confirmation queue is the set of pending tax rate-review entries
 * (created by the tax-dataset review workflow). Approving a tax review
 * entry resolves the legal-compliance record.
 *
 * Cache invalidation follows the tax-dataset precedent
 * (IdempotencyService.invalidateOnVersionChange): approving a review that
 * names its dataset version invalidates entries keyed on that version,
 * because results summed from offers carrying it must re-compute.
 *
 * EVERY mutating action writes a durable audit event with the operator
 * identity (`tax_rule_version`).
 *
 * @module OpsDatasetConfirmationService
 */

import { Inject, Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { AuditService } from '@rajahinta/core-domain';
import {
  RATE_REVIEW_REPOSITORY_PORT,
  type IRateReviewRepository,
  type RateReviewEntry,
} from '@rajahinta/data-acquisition';
import { IdempotencyService } from '../../idempotency';
import type {
  OpsConfirmationListResponse,
  OpsPendingTaxReview,
  OpsTaxReviewResolvedResponse,
  OperatorActionDto,
} from '../ops.dto';

@Injectable()
export class OpsDatasetConfirmationService {
  private readonly logger = new Logger(OpsDatasetConfirmationService.name);

  constructor(
    @Inject(RATE_REVIEW_REPOSITORY_PORT)
    private readonly taxReviews: IRateReviewRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Queue listing
  // -------------------------------------------------------------------------

  /**
   * Everything awaiting operator confirmation: the pending tax
   * rate-review entries.
   */
  async listPendingConfirmations(): Promise<OpsConfirmationListResponse> {
    const taxEntries = await this.taxReviews.findByStatus('pending');

    const taxReviews: OpsPendingTaxReview[] = taxEntries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      description: entry.description,
      source: entry.source,
      versionLabel: entry.versionLabel ?? null,
      confirmedBy: entry.confirmedBy ?? null,
      confirmedRole: entry.confirmedRole ?? null,
    }));

    return { taxReviews };
  }

  // -------------------------------------------------------------------------
  // Tax rate-review resolution
  // -------------------------------------------------------------------------

  /**
   * Approve a pending tax rate-review entry — the explicit manual step
   * that moves the reviewed version toward effectiveness. Mirrors
   * RateReviewSchedulerService.approveReview's transition + audit shape,
   * plus the tax-dataset cache-invalidation convention for entries that
   * name the dataset version they pertain to.
   */
  async approveTaxReview(
    reviewId: string,
    dto: OperatorActionDto,
  ): Promise<OpsTaxReviewResolvedResponse> {
    const existing = await this.requirePendingReview(reviewId);
    const resolvedAt = new Date().toISOString();
    const reviewerNotes = `Approved by ${dto.operator}.${dto.note ? ` ${dto.note.trim()}` : ''}`;

    await this.taxReviews.updateStatus(reviewId, 'resolved', 'approve', resolvedAt, reviewerNotes);

    // Any cached result referencing a version under review is recomputed —
    // conservative and correctness-safe (same convention as the tax worker).
    if (existing.versionLabel !== undefined && existing.versionLabel !== null) {
      await this.idempotency.invalidateOnVersionChange([existing.versionLabel]);
    }

    await this.audit.logChange({
      entityType: 'tax_rule_version',
      entityId: reviewId,
      action: 'confirmed',
      author: dto.operator,
      reason: reviewerNotes,
      previousValue: { status: 'pending', versionLabel: existing.versionLabel ?? null },
      newValue: { status: 'resolved', resolution: 'approve', resolvedAt },
    });

    this.logger.log(
      `Tax rate-review "${reviewId}" approved by operator "${dto.operator}"`,
    );

    return { id: reviewId, status: 'resolved', resolution: 'approve', resolvedAt };
  }

  /**
   * Reject a pending tax rate-review entry. The previous version stays
   * effective — rejection only resolves the review record; no dataset
   * transition and no cache invalidation happen.
   */
  async rejectTaxReview(
    reviewId: string,
    dto: OperatorActionDto,
  ): Promise<OpsTaxReviewResolvedResponse> {
    const existing = await this.requirePendingReview(reviewId);
    const resolvedAt = new Date().toISOString();
    const reviewerNotes = `Rejected by ${dto.operator}.${dto.note ? ` ${dto.note.trim()}` : ''}`;

    await this.taxReviews.updateStatus(reviewId, 'resolved', 'reject', resolvedAt, reviewerNotes);

    await this.audit.logChange({
      entityType: 'tax_rule_version',
      entityId: reviewId,
      action: 'updated',
      author: dto.operator,
      reason: reviewerNotes,
      previousValue: { status: 'pending', versionLabel: existing.versionLabel ?? null },
      newValue: { status: 'resolved', resolution: 'reject', resolvedAt },
    });

    this.logger.warn(
      `Tax rate-review "${reviewId}" rejected by operator "${dto.operator}" — previous version stays effective`,
    );

    return { id: reviewId, status: 'resolved', resolution: 'reject', resolvedAt };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Fetch a review entry or 404; reject non-pending entries with 409. */
  private async requirePendingReview(reviewId: string): Promise<RateReviewEntry> {
    const existing = await this.taxReviews.findById(reviewId);
    if (existing === null) {
      throw new NotFoundException(`Tax rate-review "${reviewId}" not found`);
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        `Tax rate-review "${reviewId}" is already ${existing.status}`,
      );
    }
    return existing;
  }
}

/**
 * OpsDatasetConfirmationService — console workflow for tax-rate and FX
 * dataset-version confirmation (task 12.1, change
 * technical-assessment-remediation; design D2).
 *
 * The confirmation queue is the set of PENDING_CONFIRMATION FX datasets
 * (created by the recurring FX review job, never auto-published) plus the
 * pending tax rate-review entries (created by the tax-dataset review
 * workflow). Confirming an FX dataset is the ONLY
 * PENDING_CONFIRMATION → PUBLISHED transition in the system
 * (FxRateDatasetService.confirmPublication); approving a tax review entry
 * resolves the legal-compliance record.
 *
 * Cache invalidation follows the tax-dataset precedent
 * (IdempotencyService.invalidateOnVersionChange): on FX publication the
 * entries keyed on the OLD FX dataset version — the dataset effective
 * until this confirmation — are invalidated, because converted offers
 * carry the FX version label that produced them and results summed from
 * those offers must re-compute under the newly effective rates.
 *
 * EVERY mutating action writes a durable audit event with the operator
 * identity (`fx_rate_dataset` / `tax_rule_version`).
 *
 * @module OpsDatasetConfirmationService
 */

import { Inject, Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import {
  AuditService,
  FX_RATE_DATASET_REPOSITORY_PORT,
  FxRateDatasetService,
  type FxDatasetVersion,
  type IFxRateDatasetRepositoryPort,
} from '@rajahinta/core-domain';
import {
  RATE_REVIEW_REPOSITORY_PORT,
  type IRateReviewRepository,
  type RateReviewEntry,
} from '@rajahinta/data-acquisition';
import { IdempotencyService } from '../../idempotency';
import type {
  OpsConfirmationListResponse,
  OpsFxDatasetConfirmedResponse,
  OpsPendingFxDataset,
  OpsPendingTaxReview,
  OpsTaxReviewResolvedResponse,
  OperatorActionDto,
} from '../ops.dto';

@Injectable()
export class OpsDatasetConfirmationService {
  private readonly logger = new Logger(OpsDatasetConfirmationService.name);

  constructor(
    private readonly fxDatasets: FxRateDatasetService,
    @Inject(FX_RATE_DATASET_REPOSITORY_PORT)
    private readonly fxRepo: IFxRateDatasetRepositoryPort,
    @Inject(RATE_REVIEW_REPOSITORY_PORT)
    private readonly taxReviews: IRateReviewRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Queue listing
  // -------------------------------------------------------------------------

  /**
   * Everything awaiting operator confirmation: FX datasets in
   * PENDING_CONFIRMATION (with rates for provenance display) and pending
   * tax rate-review entries.
   */
  async listPendingConfirmations(): Promise<OpsConfirmationListResponse> {
    const [fxVersions, taxEntries] = await Promise.all([
      this.fxDatasets.listPendingDatasets(),
      this.taxReviews.findByStatus('pending'),
    ]);

    const fx: OpsPendingFxDataset[] = [];
    for (const version of fxVersions) {
      const rates = await this.fxRepo.findRatesForDataset(version.id);
      fx.push({
        id: version.id,
        versionLabel: version.versionLabel,
        status: 'PENDING_CONFIRMATION',
        sourceName: version.sourceName,
        sourceUrl: version.sourceUrl,
        referenceDate: version.referenceDate,
        effectiveFrom: version.effectiveFrom.toISOString(),
        effectiveTo: version.effectiveTo === null ? null : version.effectiveTo.toISOString(),
        rates: rates.map((rate) => ({
          baseCurrency: rate.baseCurrency,
          quoteCurrency: rate.quoteCurrency,
          rate: rate.rate,
        })),
      });
    }

    const taxReviews: OpsPendingTaxReview[] = taxEntries.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      description: entry.description,
      source: entry.source,
      versionLabel: entry.versionLabel ?? null,
      confirmedBy: entry.confirmedBy ?? null,
      confirmedRole: entry.confirmedRole ?? null,
    }));

    return { fx, taxReviews };
  }

  // -------------------------------------------------------------------------
  // FX dataset confirmation
  // -------------------------------------------------------------------------

  /**
   * Confirm (publish) a pending FX dataset.
   *
   * Captures the currently effective published dataset BEFORE the
   * transition — that is the version cached calculation results are keyed
   * on — then publishes and invalidates every idempotency-cache entry
   * referencing the old version's label, matching the tax-dataset
   * convention on dataset-version change.
   */
  async confirmFxDataset(
    datasetId: number,
    dto: OperatorActionDto,
  ): Promise<OpsFxDatasetConfirmedResponse> {
    // The predecessor must be read before publishing — after the
    // transition it is no longer the dataset effective "now".
    let predecessor: FxDatasetVersion | null = null;
    try {
      predecessor = await this.fxRepo.findPublishedDatasetEffectiveOn(new Date());
    } catch (err) {
      this.logger.error(
        `Could not resolve the currently effective FX dataset before confirming ${datasetId} — ` +
          `proceeding without predecessor-based invalidation (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    let published: FxDatasetVersion;
    try {
      published = await this.fxDatasets.confirmPublication(datasetId, dto.operator);
    } catch (err) {
      throw this.mapFxError(datasetId, err);
    }

    const invalidatedVersion =
      predecessor !== null && predecessor.id !== published.id
        ? predecessor.versionLabel
        : null;
    if (invalidatedVersion !== null) {
      await this.idempotency.invalidateOnVersionChange([invalidatedVersion]);
      this.logger.log(
        `Invalidated idempotency-cache entries keyed on FX dataset version "${invalidatedVersion}"`,
      );
    }

    await this.audit.logChange({
      entityType: 'fx_rate_dataset',
      entityId: published.versionLabel,
      action: 'confirmed',
      author: dto.operator,
      reason: dto.note?.trim() || 'FX dataset publication confirmed via operator console',
      previousValue: { status: 'PENDING_CONFIRMATION', id: published.id },
      newValue: {
        status: 'PUBLISHED',
        confirmedAt: published.confirmedAt?.toISOString() ?? new Date().toISOString(),
        invalidatedVersion,
      },
    });

    this.logger.warn(
      `FX dataset "${published.versionLabel}" published by operator "${dto.operator}" — ` +
        `entries keyed on "${invalidatedVersion ?? 'none'}" invalidated`,
    );

    return {
      id: published.id,
      versionLabel: published.versionLabel,
      status: 'PUBLISHED',
      confirmedAt: published.confirmedAt?.toISOString() ?? new Date().toISOString(),
      invalidatedVersion,
    };
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

  /**
   * Map core-domain FX errors onto the HTTP vocabulary. Name matching
   * instead of instanceof — the error classes are exported from the fx
   * barrel but not the package root, and name matching also survives
   * duplicate-module instances across workspace builds (same rationale as
   * FxDatasetReviewService).
   */
  private mapFxError(datasetId: number, err: unknown): Error {
    if (err instanceof Error && err.name === 'FxDatasetNotFoundError') {
      return new NotFoundException(`FX dataset ${datasetId} not found`);
    }
    if (err instanceof Error && err.name === 'FxDatasetInvalidTransitionError') {
      return new ConflictException(err.message);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

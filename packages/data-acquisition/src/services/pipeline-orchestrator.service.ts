/**
 * Pipeline orchestrator service.
 *
 * Manages the full data-acquisition lifecycle for a single merchant:
 * 1. Check governance permission (gate) — merchants without GRANTED status are skipped
 * 2. Fetch product data from a merchant feed/API (via FeedIngestionService)
 * 3. Map raw data to Product Master / Retail Offer records (via DataMappingService)
 * 4. Call the upsert repository to persist records
 * 5. Log ingestion results (records added, updated, failed)
 *
 * Permission gating happens before any fetch or upsert call.  A merchant
 * must have a GRANTED permission status in SourceGovernanceService or the
 * pipeline exits early with a gate-failure report.
 *
 * The orchestrator is merchant-agnostic — merchant-specific logic is
 * encapsulated in IFeedAdapter implementations registered under
 * FEED_ADAPTERS_TOKEN.
 *
 * @module PipelineOrchestratorService
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SourceGovernanceService } from '@rajahinta/core-domain';
import type { PermissionCheckResult, PermissionStatus } from '@rajahinta/core-domain';
import { FeedIngestionService } from './feed-ingestion.service';
import { DataMappingService } from './data-mapping.service';
import { DataQualityService } from './data-quality.service';
import type { DataQualityReport } from './data-quality.service';
import { ContentLintService } from '../content/content-lint.service';
import type { ContentViolation } from '../content/content-lint.service';
import {
  UPSERT_REPOSITORY_TOKEN,
  type IUpsertRepository,
} from '../interfaces/upsert-port.interface';
import {
  OFFER_CHANGE_HOOK_TOKEN,
  type IOfferChangeHook,
} from '../interfaces/offer-change-hook.interface';
import type { MerchantConfig } from '../interfaces/merchant-config.interface';

/**
 * Result of the governance permission gate check.
 *
 * Included in the pipeline run report when the gate rejects a merchant
 * so callers can distinguish skipped-from-gate from empty-result.
 */
export interface PermissionGateResult {
  /** True when the merchant is permitted to proceed. */
  readonly permitted: boolean;
  /** The resolved permission status from governance. */
  readonly status: PermissionStatus;
  /** Human-readable reason for the gate decision. */
  readonly reason: string;
}

/** Detailed report for a single pipeline run. */
export interface PipelineRunReport {
  readonly merchantId: string;
  readonly recordsFetched: number;
  readonly recordsAdded: number;
  readonly recordsUpdated: number;
  /**
   * Offers in this run whose upsert changed the persisted (merchant,
   * product) price series (first sighting or price move). This is the
   * per-run cost driver of the observation recorder — the hook fires once
   * per counted offer.
   */
  readonly offersChanged: number;
  readonly errors: string[];
  readonly durationMs: number;
  /**
   * Present when the governance gate rejected the merchant before any
   * fetch/upsert occurred.  Undefined when the gate passed (allowing
   * the pipeline to run) or when no governance check was performed.
   */
  readonly gateResult?: PermissionGateResult;
  /**
   * Automated data-quality report run after upserting every offer in
   * this batch.  Undefined when no offers were upserted (gate rejected,
   * no records fetched, or all upserts failed).
   */
  readonly qualityReport?: DataQualityReport;
  /**
   * Content-policy violations detected during linting of product names
   * in this batch.  Empty array when no violations were found or when no
   * records were mapped.
   *
   * Linting is a warning mechanism — violations do not block ingestion.
   */
  readonly contentViolations: ContentViolation[];
}

@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    private readonly feedIngestion: FeedIngestionService,
    private readonly dataMapping: DataMappingService,
    private readonly dataQuality: DataQualityService,
    @Inject(UPSERT_REPOSITORY_TOKEN)
    private readonly upsertRepository: IUpsertRepository,
    private readonly governanceService: SourceGovernanceService,
    private readonly contentLint: ContentLintService,

    // Optional by design: hosts that do not register an adapter (tests,
    // stand-alone application-api usage) run the pipeline unchanged. The
    // backend composition root binds this to the price-observation
    // recorder hook (change 2026-08-26-phase2-historical-price-intelligence,
    // task 2.2) so observations are appended strictly on the background
    // ingestion path — never from a request handler.
    @Optional()
    @Inject(OFFER_CHANGE_HOOK_TOKEN)
    private readonly offerChangeHook?: IOfferChangeHook,
  ) {}

  /**
   * Run the full ingestion pipeline for a single merchant.
   *
   * Before fetching any data the governance gate is checked.  Merchants
   * without GRANTED permission status are skipped with a gate-failure
   * report.  Merchants with an empty `feedUrl` are also skipped as a
   * technical prerequisite (no adapter implementation yet).
   */
  async runForMerchant(config: MerchantConfig): Promise<PipelineRunReport> {
    const start = Date.now();

    // -- Gate 1: Technical prerequisite ---------------------------------------
    if (!config.feedUrl) {
      this.logger.warn(
        `Skipping merchant "${config.merchantId}": no feed URL`,
      );
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: [],
        durationMs: Date.now() - start,
        contentViolations: [],
      };
    }

    // -- Gate 2: Governance permission ----------------------------------------
    const gateResult = await this.checkMerchantPermission(config.merchantId);
    if (!gateResult.permitted) {
      this.logger.warn(
        `Skipping merchant "${config.merchantId}": ${gateResult.reason}`,
      );
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: [],
        durationMs: Date.now() - start,
        gateResult,
        contentViolations: [],
      };
    }

    // -- Step 1: Fetch --------------------------------------------------------
    const fetchResult = await this.feedIngestion.fetchFromMerchant(
      config.merchantId,
      config.feedUrl,
      config.feedFormat,
    );

    if (fetchResult.errors.length > 0) {
      this.logger.warn(
        `Fetch warnings/errors for "${config.merchantId}": ${fetchResult.errors.join('; ')}`,
      );
    }

    if (fetchResult.records.length === 0) {
      return {
        merchantId: config.merchantId,
        recordsFetched: 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        offersChanged: 0,
        errors: fetchResult.errors,
        durationMs: Date.now() - start,
        contentViolations: [],
      };
    }

    // -- Step 2: Map ----------------------------------------------------------
    // The registry row's market flows onto the offer (replacing the
    // Phase 1 'DE' placeholder) — task 7.3's registry consumption.
    const mapped = this.dataMapping.mapBatch(
      fetchResult.records,
      config.merchantId,
      config.country,
    );

    // -- Step 3: Lint ---------------------------------------------------------
    const contentViolations: ContentViolation[] = [];
    for (const pair of mapped) {
      const result = this.contentLint.lintProductContent(
        pair.product.name,
        '', // description — not available in Phase 1 feed data
      );
      contentViolations.push(...result.violations);
    }

    if (contentViolations.length > 0) {
      this.logger.warn(
        `Content violations for "${config.merchantId}": ${contentViolations.length} found`,
      );
    }

    // -- Step 4: Upsert -------------------------------------------------------
    let recordsAdded = 0;
    let recordsUpdated = 0;
    let offersChanged = 0;
    const upsertErrors: string[] = [];

    // Track upserted offers for the quality check — we build lightweight
    // RetailOfferRecord-compatible objects from the mapped data.
    const upsertedOffers: Array<{
      merchant: string;
      productId: number;
      observedAt: Date;
      reliabilityStatus: string;
    }> = [];

    for (const pair of mapped) {
      try {
        const upsertResult = await this.upsertRepository.upsertProduct(
          pair.product,
        );
        if (upsertResult.created) {
          recordsAdded++;
        } else {
          recordsUpdated++;
        }

        const offerResult = await this.upsertRepository.upsertOffer({
          ...pair.offerInput,
          productId: upsertResult.productId,
        });

        upsertedOffers.push({
          merchant: config.merchantId,
          productId: upsertResult.productId,
          observedAt: pair.offerInput.observedAt,
          reliabilityStatus: pair.offerInput.reliabilityStatus,
        });

        // -- Step 4b: Changed-offer hook -------------------------------------
        // Fires exactly once per CHANGED offer, after the row is durably
        // upserted. The backend binds this to the price-observation
        // recorder, so this is the single point where the observation log
        // grows — strictly on the background ingestion path. Failure
        // isolation is mandatory: a recorder error (including expected
        // classification-gate rejections) is logged and the run continues
        // with the remaining offers; it must never abort ingestion or
        // pollute the run's error list.
        if (offerResult.changed) {
          offersChanged++;

          if (this.offerChangeHook) {
            try {
              await this.offerChangeHook.onOfferChanged({
                productId: upsertResult.productId,
                offerId: offerResult.offerId,
                merchant: config.merchantId,
                country: pair.offerInput.country,
                priceCents: pair.offerInput.priceCents,
                reliabilityStatus: pair.offerInput.reliabilityStatus,
                observedAt: pair.offerInput.observedAt,
              });
            } catch (hookErr) {
              const message =
                hookErr instanceof Error
                  ? hookErr.message
                  : 'Unknown offer-change hook error';
              this.logger.error(
                `Offer-change hook failed for offer ${offerResult.offerId} ` +
                  `(merchant "${config.merchantId}", product ` +
                  `${upsertResult.productId}); observation not recorded, ` +
                  `ingestion continues: ${message}`,
              );
            }
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown upsert error';
        upsertErrors.push(
          `Failed to upsert product "${pair.product.name}": ${message}`,
        );
      }
    }

    // -- Step 5: Quality check ------------------------------------------------
    let qualityReport: DataQualityReport | undefined;
    if (upsertedOffers.length > 0) {
      qualityReport = this.dataQuality.runQualityCheck(upsertedOffers);
    }

    // -- Step 6: Log ----------------------------------------------------------
    const durationMs = Date.now() - start;
    const allErrors = [...fetchResult.errors, ...upsertErrors];

    const logParts = [
      `Pipeline run for "${config.merchantId}": `,
      `${fetchResult.records.length} fetched, `,
      `${recordsAdded} added, ${recordsUpdated} updated, `,
      `${offersChanged} offers changed, `,
      `${allErrors.length} errors, ${durationMs} ms`,
    ];

    if (contentViolations.length > 0) {
      logParts.push(`, ${contentViolations.length} content violations`);
    }
    if (qualityReport && qualityReport.flaggedIssues.length > 0) {
      logParts.push(
        `, ${qualityReport.flaggedIssues.length} quality issues`,
      );
    }

    this.logger.log(logParts.join(''));

    return {
      merchantId: config.merchantId,
      recordsFetched: fetchResult.records.length,
      recordsAdded,
      recordsUpdated,
      offersChanged,
      errors: allErrors,
      durationMs,
      qualityReport,
      contentViolations,
    };
  }

  /**
   * Run the pipeline for all merchants.
   *
   * Each merchant's config is passed through the governance gate
   * individually — some may be skipped while others are ingested.
   */
  async runAll(configs: MerchantConfig[]): Promise<PipelineRunReport[]> {
    const results: PipelineRunReport[] = [];

    for (const config of configs) {
      const report = await this.runForMerchant(config);
      results.push(report);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Check whether the merchant has permission to be ingested.
   *
   * Returns a {@link PermissionGateResult} indicating the resolved status.
   * Merchants with no governance records are treated as PENDING (off).
   * Governance service errors are caught and reported as PENDING so a
   * repository outage does not accidentally grant access.
   */
  private async checkMerchantPermission(
    merchantId: string,
  ): Promise<PermissionGateResult> {
    let result: PermissionCheckResult;

    try {
      result = await this.governanceService.checkPermission(merchantId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown governance error';
      this.logger.error(
        `Governance check failed for merchant "${merchantId}": ${message}`,
      );
      return {
        permitted: false,
        status: 'PENDING',
        reason: 'Governance check error — defaulting to PENDING',
      };
    }

    if (result.sources.length === 0) {
      return {
        permitted: false,
        status: 'PENDING',
        reason: 'No governance records found — defaulting to PENDING',
      };
    }

    if (result.permissionStatus === 'GRANTED') {
      return {
        permitted: true,
        status: 'GRANTED',
        reason: 'Permission granted',
      };
    }

    return {
      permitted: false,
      status: result.permissionStatus,
      reason: `Permission status is ${result.permissionStatus}`,
    };
  }
}
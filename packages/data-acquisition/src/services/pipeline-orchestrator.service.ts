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

import { Inject, Injectable, Logger } from '@nestjs/common';
import { SourceGovernanceService } from '@rajahinta/core-domain';
import type { PermissionCheckResult, PermissionStatus } from '@rajahinta/core-domain';
import { FeedIngestionService } from './feed-ingestion.service';
import { DataMappingService } from './data-mapping.service';
import {
  UPSERT_REPOSITORY_TOKEN,
  type IUpsertRepository,
} from '../interfaces/upsert-port.interface';
import type { MerchantConfig } from '../config/merchants.config';

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
  readonly errors: string[];
  readonly durationMs: number;
  /**
   * Present when the governance gate rejected the merchant before any
   * fetch/upsert occurred.  Undefined when the gate passed (allowing
   * the pipeline to run) or when no governance check was performed.
   */
  readonly gateResult?: PermissionGateResult;
}

@Injectable()
export class PipelineOrchestratorService {
  private readonly logger = new Logger(PipelineOrchestratorService.name);

  constructor(
    private readonly feedIngestion: FeedIngestionService,
    private readonly dataMapping: DataMappingService,
    @Inject(UPSERT_REPOSITORY_TOKEN)
    private readonly upsertRepository: IUpsertRepository,
    private readonly governanceService: SourceGovernanceService,
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
        errors: [],
        durationMs: Date.now() - start,
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
        errors: [],
        durationMs: Date.now() - start,
        gateResult,
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
        errors: fetchResult.errors,
        durationMs: Date.now() - start,
      };
    }

    // -- Step 2: Map ----------------------------------------------------------
    const mapped = this.dataMapping.mapBatch(
      fetchResult.records,
      config.merchantId,
    );

    // -- Step 3: Upsert -------------------------------------------------------
    let recordsAdded = 0;
    let recordsUpdated = 0;
    const upsertErrors: string[] = [];

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

        await this.upsertRepository.upsertOffer({
          ...pair.offerInput,
          productId: upsertResult.productId,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown upsert error';
        upsertErrors.push(
          `Failed to upsert product "${pair.product.name}": ${message}`,
        );
      }
    }

    // -- Step 4: Log ----------------------------------------------------------
    const durationMs = Date.now() - start;
    const allErrors = [...fetchResult.errors, ...upsertErrors];

    this.logger.log(
      `Pipeline run for "${config.merchantId}": ` +
        `${fetchResult.records.length} fetched, ` +
        `${recordsAdded} added, ${recordsUpdated} updated, ` +
        `${allErrors.length} errors, ${durationMs} ms`,
    );

    return {
      merchantId: config.merchantId,
      recordsFetched: fetchResult.records.length,
      recordsAdded,
      recordsUpdated,
      errors: allErrors,
      durationMs,
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
/**
 * Source governance service.
 *
 * Tracks how merchant product data is acquired, what permission status each
 * source holds, and provides a compliance check before the pipeline ingests
 * data from a merchant.  Every ingestion should be preceded by a permission
 * check to ensure the source is still GRANTED.
 *
 * The service delegates persistence to an {@link ISourceGovernanceRepository}
 * adapter wired at the composition root.  This keeps the domain free of
 * ORM and database concerns.
 *
 * @module SourceGovernanceService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SOURCE_GOVERNANCE_REPOSITORY_PORT,
  type ISourceGovernanceRepository,
} from '../ports/source-governance-repository.port';
import type {
  AcquisitionMethod,
  PermissionStatus,
  SourceGovernanceRecord,
  RegisterSourceInput,
  PermissionCheckResult,
} from '../source-governance.types';

@Injectable()
export class SourceGovernanceService {
  private readonly logger = new Logger(SourceGovernanceService.name);

  constructor(
    @Inject(SOURCE_GOVERNANCE_REPOSITORY_PORT)
    private readonly repository: ISourceGovernanceRepository,
  ) {}

  /**
   * Register a new data source for a merchant.
   *
   * Creates a governance record that documents how the source data is
   * acquired and what its current permission status is.  New sources
   * are typically registered with PENDING status and transitioned to
   * GRANTED after a compliance review.
   *
   * @param merchantId       Stable merchant identifier.
   * @param acquisitionMethod How this source is acquired.
   * @param permissionStatus Initial permission status.
   * @param sourceUrl        URL or reference for the data origin.
   * @returns                The created governance record.
   */
  async registerSource(
    merchantId: string,
    acquisitionMethod: AcquisitionMethod,
    permissionStatus: PermissionStatus,
    sourceUrl: string,
  ): Promise<SourceGovernanceRecord> {
    const input: RegisterSourceInput = {
      merchantId,
      acquisitionMethod,
      permissionStatus,
      sourceUrl,
    };

    const record = await this.repository.create(input);

    this.logger.log(
      `Registered source for merchant "${merchantId}": ` +
        `${acquisitionMethod} (${permissionStatus})`,
    );

    return record;
  }

  /**
   * Check the current permission status for a merchant.
   *
   * Aggregates across all registered sources.  Returns the most favourable
   * active status with warnings if any source has lapsed or been revoked.
   * Returns undefined when the merchant has no registered sources.
   */
  async checkPermission(
    merchantId: string,
  ): Promise<PermissionCheckResult> {
    return this.repository.checkPermission(merchantId);
  }

  /**
   * Revoke all permissions for a merchant.
   *
   * Marks every registered source for the merchant as REVOKED.  This is the
   * primary revocation method — used when a merchant agreement ends or a
   * compliance issue is discovered.
   *
   * @param merchantId Merchant whose sources should be revoked.
   * @param reason     Human-readable reason for the revocation.
   * @returns          Number of sources that were updated.
   */
  async revokePermission(
    merchantId: string,
    reason: string,
  ): Promise<number> {
    const count = await this.repository.revokeAllByMerchantId(
      merchantId,
      reason,
    );

    this.logger.warn(
      `Permission revoked for merchant "${merchantId}" ` +
        `(${count} source(s)): ${reason}`,
    );

    return count;
  }

  /**
   * Revoke a single source by its governance record ID.
   *
   * Useful for targeted revocation when only one source is non-compliant
   * while others remain GRANTED.
   *
   * @param id     ID of the governance record to revoke.
   * @param reason Human-readable reason for the revocation.
   */
  async revokeSourceById(
    id: number,
    reason: string,
  ): Promise<SourceGovernanceRecord | null> {
    const updated = await this.repository.updateStatus(id, 'REVOKED', reason);

    if (updated) {
      this.logger.warn(
        `Source ${id} (merchant "${updated.merchantId}") revoked: ${reason}`,
      );
    } else {
      this.logger.warn(
        `Attempted to revoke non-existent source governance record ${id}`,
      );
    }

    return updated;
  }

  /**
   * List all registered data sources for a merchant.
   *
   * Returns records ordered by creation date descending (most recent first).
   */
  async listMerchantSources(
    merchantId: string,
  ): Promise<SourceGovernanceRecord[]> {
    return this.repository.findByMerchantId(merchantId);
  }

  /**
   * Find a single governance record by its ID.
   */
  async findById(id: number): Promise<SourceGovernanceRecord | null> {
    return this.repository.findById(id);
  }
}
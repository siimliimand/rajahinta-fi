/**
 * Port interface for source governance persistence.
 *
 * Core Domain owns this port so the governance service depends on an
 * abstraction, not on a specific repository implementation.  The concrete
 * adapter lives in the composition root (typically DataPlatform or
 * ApplicationApi) and wires the actual Drizzle repository behind this
 * contract at bootstrap time.
 *
 * @module SourceGovernanceRepositoryPort
 */

import type {
  SourceGovernanceRecord,
  RegisterSourceInput,
  PermissionCheckResult,
} from '../source-governance.types';

/** Injection token for the source governance repository. */
export const SOURCE_GOVERNANCE_REPOSITORY_PORT =
  'SOURCE_GOVERNANCE_REPOSITORY_PORT';

/**
 * Repository contract for source governance persistence.
 *
 * Consumers inject this interface.  An adapter in the composition root
 * maps the concrete data-platform repository to this port.
 */
export interface ISourceGovernanceRepository {
  /**
   * Persist a new governance record for a merchant data source.
   *
   * Returns the created record with its auto-generated ID and timestamps.
   */
  create(input: RegisterSourceInput): Promise<SourceGovernanceRecord>;

  /**
   * Update the permission status of a specific governance record.
   *
   * Also sets `statusReason` when provided and updates `updatedAt`.
   * Returns the updated record or null if the record does not exist.
   */
  updateStatus(
    id: number,
    status: SourceGovernanceRecord['permissionStatus'],
    reason?: string,
  ): Promise<SourceGovernanceRecord | null>;

  /**
   * Revoke all sources for a merchant by setting their status to REVOKED.
   *
   * Returns the number of records that were updated.
   */
  revokeAllByMerchantId(
    merchantId: string,
    reason: string,
  ): Promise<number>;

  /**
   * Retrieve all governance records for a merchant.
   *
   * Ordered by `createdAt` descending (most recent first).
   */
  findByMerchantId(merchantId: string): Promise<SourceGovernanceRecord[]>;

  /**
   * Find a single governance record by its ID.
   */
  findById(id: number): Promise<SourceGovernanceRecord | null>;

  /**
   * Return the latest permission status for a merchant, aggregated across
   * all of their registered sources.
   *
   * The aggregation logic is:
   *   - If any source is GRANTED → GRANTED (with warnings if others are non-granted)
   *   - Else if any is PENDING → PENDING
   *   - Else if any is EXPIRED → EXPIRED
   *   - Else if any is REVOKED → REVOKED
   */
  checkPermission(merchantId: string): Promise<PermissionCheckResult>;
}
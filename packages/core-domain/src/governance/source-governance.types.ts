/**
 * Source governance types.
 *
 * Defines the data model for tracking merchant data-source provenance and
 * permission status.  Every data point ingested by the acquisition pipeline
 * must be traceable to a permitted source so the platform can demonstrate
 * compliance with merchant agreements and data-use policies.
 *
 * @module SourceGovernanceTypes
 */

// ---------------------------------------------------------------------------
// Enumerated types
// ---------------------------------------------------------------------------

/**
 * How the merchant's product data is acquired.
 *
 * Each method implies a different level of contractual or technical control
 * and maps to specific compliance obligations.
 */
export type AcquisitionMethod =
  | 'PERMITTED_FEED'
  | 'RETAILER_API'
  | 'STRUCTURED_MERCHANT_FEED'
  | 'LICENSED_PROVIDER'
  | 'COMPLIANT_CRAWLING'
  | 'MANUAL_VERIFICATION';

/**
 * Current compliance / permission status for a data source.
 */
export type PermissionStatus = 'GRANTED' | 'PENDING' | 'REVOKED' | 'EXPIRED';

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/**
 * A governance record linking a merchant to a permitted data source.
 *
 * Immutable once created except for status transitions (GRANTED → REVOKED,
 * GRANTED → EXPIRED, PENDING → GRANTED, PENDING → REVOKED).  Status is
 * tracked via the current `permissionStatus` field; a full audit trail of
 * status changes is out of scope for this record and belongs in a dedicated
 * event-sourced table in the data platform.
 */
export interface SourceGovernanceRecord {
  /** Auto-generated primary key. */
  readonly id: number;
  /** Stable merchant identifier. */
  readonly merchantId: string;
  /** How this source is acquired. */
  readonly acquisitionMethod: AcquisitionMethod;
  /** Current permission/compliance state. */
  readonly permissionStatus: PermissionStatus;
  /** URL or reference identifying the origin of this source. */
  readonly sourceUrl: string;
  /** Reason for the current status (required when REVOKED, optional otherwise). */
  readonly statusReason: string | null;
  /** Date of the last permission verification. */
  readonly lastVerifiedAt: Date;
  /** Timestamp of record creation. */
  readonly createdAt: Date;
  /** Timestamp of the last status update. */
  readonly updatedAt: Date;
}

/**
 * Input for registering a new source governance record.
 */
export interface RegisterSourceInput {
  readonly merchantId: string;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly permissionStatus: PermissionStatus;
  readonly sourceUrl: string;
  readonly statusReason?: string;
}

/**
 * Result of a permission-status check for a merchant.
 *
 * Returns the most permissive active status across all registered sources;
 * when no sources are registered the status is undefined.
 */
export interface PermissionCheckResult {
  readonly merchantId: string;
  /** Highest-priority permission status (GRANTED > PENDING > EXPIRED > REVOKED). */
  readonly permissionStatus: PermissionStatus;
  /** Individual source records that were evaluated. */
  readonly sources: SourceGovernanceRecord[];
  /** When true, at least one source expired or was revoked. */
  readonly hasWarnings: boolean;
}
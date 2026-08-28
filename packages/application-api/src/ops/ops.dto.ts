/**
 * Operator-console DTOs — request/response shapes for the `/ops/console`
 * API (task 12.1, change technical-assessment-remediation).
 *
 * Pure interfaces with no NestJS or swagger coupling so they can be shared
 * with the frontend's API types, following the correction.dto.ts precedent.
 *
 * The console is its own auth realm: every route sits behind OpsAccessGuard
 * (env-configured operator bearer token + IP allowlist, fail-closed) and the
 * OPERATOR_CONSOLE feature flag. Operator identity for the audit trail is
 * supplied per action via the `operator` request field — interactive login
 * is documented future work (design open question, "separate path" answer).
 *
 * @module OpsDto
 */

import type { AcquisitionMethod, PermissionStatus } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Shared request fields
// ---------------------------------------------------------------------------

/**
 * Every mutating console action carries an operator identity string.
 * It is recorded as the audit `author` — the bearer token proves realm
 * membership, this attribute names the human acting.
 */
export interface OperatorActionDto {
  /** Operator identity recorded in the audit trail (1–128 chars). */
  readonly operator: string;
  /** Free-text note recorded as the audit reason. */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Governance — permission grants per merchant
// ---------------------------------------------------------------------------

/** POST /ops/console/governance/:merchantId/grant request body. */
export interface GrantGovernanceDto extends OperatorActionDto {
  /** How the merchant's data is acquired (governance enum). */
  readonly acquisitionMethod: AcquisitionMethod;
  /** URL or reference identifying the data origin. */
  readonly sourceUrl: string;
}

/** POST /ops/console/governance/:merchantId/revoke request body. */
export interface RevokeGovernanceDto extends OperatorActionDto {
  /** Human-readable reason; required for revocation. */
  readonly reason: string;
}

/** One registry merchant with its aggregated governance state. */
export interface OpsGovernanceMerchant {
  /** Stable merchant identifier (registry + governance join key). */
  readonly merchantId: string;
  /** Human-readable merchant name from the registry. */
  readonly name: string;
  /** Merchant market (ISO 3166-1 alpha-2). */
  readonly country: string;
  /** Feed URL; empty marks an adapter that is not live yet. */
  readonly feedUrl: string;
  /** Aggregated permission status; PENDING when no records exist. */
  readonly permissionStatus: PermissionStatus;
  /** Number of registered governance sources for the merchant. */
  readonly sourceCount: number;
  /** True when at least one source is expired or revoked. */
  readonly hasWarnings: boolean;
}

/** GET /ops/console/governance response. */
export interface OpsGovernanceListResponse {
  readonly items: OpsGovernanceMerchant[];
  readonly total: number;
}

/** Result of a grant/revoke mutation. */
export interface OpsGovernanceMutationResponse {
  readonly merchantId: string;
  /** Aggregated status after the mutation. */
  readonly permissionStatus: PermissionStatus;
  /** Number of governance sources updated by this action. */
  readonly updatedSources: number;
  /** False when the requested state already held (no-op, nothing audited). */
  readonly changed: boolean;
}

// ---------------------------------------------------------------------------
// Dataset-version confirmation — FX datasets + tax rate-review entries
// ---------------------------------------------------------------------------

/** A pending FX dataset awaiting operator confirmation. */
export interface OpsPendingFxDataset {
  readonly id: number;
  /** Dataset identity used for provenance and cache invalidation. */
  readonly versionLabel: string;
  readonly status: 'PENDING_CONFIRMATION';
  readonly sourceName: string;
  readonly sourceUrl: string | null;
  /** ISO-8601 date the source published the rates (YYYY-MM-DD). */
  readonly referenceDate: string;
  /** ISO-8601 start of the effective window. */
  readonly effectiveFrom: string;
  /** ISO-8601 end of the effective window, null = open-ended. */
  readonly effectiveTo: string | null;
  /** Rates carried by the version (provenance display). */
  readonly rates: readonly { baseCurrency: string; quoteCurrency: string; rate: number }[];
}

/** A pending tax rate-review entry (the tax-rate confirmation task). */
export interface OpsPendingTaxReview {
  /** Review entry id (UUID). */
  readonly id: string;
  readonly createdAt: string;
  readonly description: string;
  readonly source: string;
  /** Dataset version the entry pertains to, when known. */
  readonly versionLabel: string | null;
  /** Person who performed the legal confirmation pre-check. */
  readonly confirmedBy: string | null;
  readonly confirmedRole: string | null;
}

/** GET /ops/console/confirmations response. */
export interface OpsConfirmationListResponse {
  readonly fx: OpsPendingFxDataset[];
  readonly taxReviews: OpsPendingTaxReview[];
}

/** POST /ops/console/confirmations/fx/:id/confirm response. */
export interface OpsFxDatasetConfirmedResponse {
  readonly id: number;
  readonly versionLabel: string;
  readonly status: 'PUBLISHED';
  /** ISO-8601 publication timestamp. */
  readonly confirmedAt: string;
  /** FX dataset version whose cache entries were invalidated (the replaced one). */
  readonly invalidatedVersion: string | null;
}

/** POST /ops/console/confirmations/tax/:id/{approve,reject} response. */
export interface OpsTaxReviewResolvedResponse {
  readonly id: string;
  readonly status: 'resolved';
  readonly resolution: 'approve' | 'reject';
  readonly resolvedAt: string;
}

// ---------------------------------------------------------------------------
// Correction queue
// ---------------------------------------------------------------------------

/** POST /ops/console/corrections — open a correction from the console. */
export interface OpsCreateCorrectionDto {
  readonly targetType: 'calculation' | 'data_point';
  readonly targetId: number;
  readonly reason: string;
  /** Operator identity recorded in the audit trail. */
  readonly operator: string;
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/** One durable audit entry, as surfaced in the console trail. */
export interface OpsAuditEntry {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly author: string;
  readonly reason: string;
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
}

/** GET /ops/console/audit response. */
export interface OpsAuditListResponse {
  readonly items: OpsAuditEntry[];
  readonly total: number;
}

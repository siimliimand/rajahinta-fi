/**
 * Correction DTOs — request/response shapes for the correction/flagging API.
 *
 * These are pure interfaces with no NestJS or swagger coupling so they can
 * be shared with API client packages or alternative frontends.
 *
 * @module CorrectionDto
 */

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

/** POST /api/v1/corrections — flag a calculation or data point for review. */
export interface CreateCorrectionDto {
  /** The kind of target being flagged ('calculation' | 'data_point'). */
  readonly targetType: 'calculation' | 'data_point';
  /** Identifier of the target record. */
  readonly targetId: number;
  /** Human-readable reason for the correction flag. */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** A single correction item returned in list/responses. */
export interface CorrectionItem {
  /** Unique correction flag identifier. */
  readonly id: number;
  /** The kind of target being flagged. */
  readonly targetType: 'calculation' | 'data_point';
  /** Identifier of the target record. */
  readonly targetId: number;
  /** Human-readable reason supplied at creation time. */
  readonly reason: string;
  /** Current review status. */
  readonly status: 'open' | 'resolved';
  /** ISO-8601 timestamp of flag creation. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of resolution, null while open. */
  readonly resolvedAt: string | null;
  /** Resolution notes recorded when the flag was closed, null while open. */
  readonly resolution: string | null;
}

/** GET /api/v1/corrections — paginated list of correction flags. */
export interface CorrectionListResponse {
  /** The correction items on this page. */
  readonly items: CorrectionItem[];
  /** Total number of items matching the query (not just this page). */
  readonly total: number;
}
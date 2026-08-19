/**
 * Port interfaces for correction persistence.
 *
 * Core Domain owns these ports so the correction service depends on
 * abstractions, not on specific repository implementations. The concrete
 * adapters live in the composition root (typically DataPlatform or
 * ApplicationApi) and wire the actual Drizzle repositories behind these
 * contracts at bootstrap time.
 *
 * @module CorrectionRepositoryPort
 */

import type {
  FlaggedItem,
  FlagStatus,
  FlagTargetType,
} from './correction.types';

// ---------------------------------------------------------------------------
// ICorrectionRepository — flagged-item CRUD
// ---------------------------------------------------------------------------

/** Injection token for ICorrectionRepository. */
export const CORRECTION_REPOSITORY_PORT = 'CORRECTION_REPOSITORY_PORT';

/**
 * Repository contract for flagged-item persistence.
 *
 * Consumers inject this interface. An adapter in the composition root
 * maps the concrete data-platform repository to this port.
 */
export interface ICorrectionRepository {
  /**
   * Persist a new flagged item.
   *
   * Returns the created flag with its auto-generated ID and timestamps.
   */
  create(data: {
    targetType: FlagTargetType;
    targetId: number;
    reason: string;
    flaggedBy: string;
    inputSnapshot: unknown | null;
  }): Promise<FlaggedItem>;

  /**
   * Update a flagged item's resolution fields.
   *
   * Sets status, resolvedBy, resolution, and note. Returns the updated
   * record, or null if the flag does not exist.
   */
  resolve(
    id: number,
    data: {
      status: FlagStatus;
      resolvedBy: string;
      resolution: FlagStatus;
      note: string | null;
    },
  ): Promise<FlaggedItem | null>;

  /**
   * Retrieve all flagged items that are still OPEN.
   *
   * Ordered by createdAt descending (most recent first).
   */
  findOpen(): Promise<FlaggedItem[]>;

  /**
   * Find a single flagged item by its ID.
   */
  findById(id: number): Promise<FlaggedItem | null>;
}

// ---------------------------------------------------------------------------
// ICorrectionCalculationRecordQuery — minimal read-only access to records
// ---------------------------------------------------------------------------

/** Injection token for ICorrectionCalculationRecordQuery. */
export const CORRECTION_CALCULATION_RECORD_QUERY_PORT =
  'CORRECTION_CALCULATION_RECORD_QUERY_PORT';

/**
 * Minimal read-only port for looking up calculation records during
 * correction workflows.
 *
 * Uses `unknown` return type because the correction module stores a generic
 * input snapshot — it does not need typed access to record fields. The
 * declaration module's ICalculationRecordQueryPort provides a typed alternative
 * for declaration-specific use.
 */
export interface ICorrectionCalculationRecordQuery {
  /**
   * Look up a calculation record by its ID.
   * Returns null when the record does not exist.
   */
  findById(id: number): Promise<unknown | null>;

  /**
   * Given a flagged entity type and ID, return the Calculation Record IDs
   * that referenced that entity. Used by the resolution workflow so that
   * ACCEPTED data-point corrections can link back to affected records.
   *
   * Supported entity types and the columns they map to:
   * - `'product'`       → `productMasterId`
   * - `'retailOffer'`   → `retailOfferIds` (JSONB array containment)
   * - `'transportOffer'`→ `transportOfferId`
   * - `'taxRule'`       → `exciseRuleVersionId` OR `containerDutyRuleVersionId`
   *
   * Returns an empty array when the entity type is unrecognised or no
   * calculation records reference the entity.
   */
  findCalculationRecordIdsByEntity(
    entityType: string,
    entityId: number,
  ): Promise<number[]>;
}
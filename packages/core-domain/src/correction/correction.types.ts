/**
 * Correction types — data model for flagging and resolving issues in
 * calculations and data points.
 *
 * @module CorrectionTypes
 */

// ---------------------------------------------------------------------------
// Flag status — lifecycle of a flagged item
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a flagged item.
 *
 * - `OPEN` — flagged, awaiting review.
 * - `ACCEPTED` — reviewer confirmed the issue.
 * - `REJECTED` — reviewer determined the flag was invalid.
 */
export type FlagStatus = 'OPEN' | 'ACCEPTED' | 'REJECTED';

// ---------------------------------------------------------------------------
// Entity types that can be flagged
// ---------------------------------------------------------------------------

/**
 * Entity types supported by the correction mechanism.
 *
 * - `calculation` — a specific calculation record (links to input snapshot).
 * - `product` — a product master record.
 * - `retailOffer` — a specific retail price offer.
 * - `transportOffer` — a carrier shipping offer.
 * - `taxRule` — a tax rate rule.
 */
export type FlagTargetType =
  | 'calculation'
  | 'product'
  | 'retailOffer'
  | 'transportOffer'
  | 'taxRule';

// ---------------------------------------------------------------------------
// Flagged item — the core data model
// ---------------------------------------------------------------------------

/**
 * A flagged item representing a potential issue in a calculation or data
 * point that requires human review.
 *
 * When `targetType` is `'calculation'`, the `inputSnapshot` field contains
 * a copy of the original `CalculationRecord` data so the flag remains
 * meaningful even if the original record changes or is deleted.
 */
export interface FlaggedItem {
  /** Auto-generated primary key. */
  readonly id: number;

  /** The type of entity being flagged. */
  readonly targetType: FlagTargetType;

  /** The ID of the entity being flagged. */
  readonly targetId: number;

  /** Human-readable explanation of why this item is flagged. */
  readonly reason: string;

  /** Current review status. */
  readonly status: FlagStatus;

  /** Who flagged this item (user ID or staff identifier). */
  readonly flaggedBy: string;

  /** When the flag was created. */
  readonly createdAt: Date;

  /** Who resolved this flag (null when still OPEN). */
  readonly resolvedBy: string | null;

  /** Resolution decision (null when still OPEN). */
  readonly resolution: FlagStatus | null;

  /** Optional note attached at resolution time. */
  readonly note: string | null;

  /**
   * Input snapshot — populated only when `targetType` is `'calculation'`.
   * Contains the full `CalculationRecord` at the time of flagging, ensuring
   * the audit trail is preserved even if the original record is later modified.
   */
  readonly inputSnapshot: unknown | null;
}
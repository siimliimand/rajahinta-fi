/**
 * Basket Calculation Record Port — abstraction for persisting basket
 * optimization results.
 *
 * Core Domain owns this port so the optimizer depends on an abstraction,
 * not on a specific repository implementation.  The concrete adapter lives
 * in the composition root (typically Data Platform) and wires the actual
 * persistence layer behind this contract at bootstrap time.
 *
 * ## Design references
 *
 * - Decision 5: basketCalculationRecords persistence, mirroring
 *   calculation records for auditability and correction.
 *
 * @module BasketCalculationRecordPort
 */

import type { BasketShipment } from '../optimizer.types';

/**
 * Data required to persist a basket optimization result.
 *
 * Minimal, mapper-friendly shape designed to match the schema's
 * `basket_calculation_records` table without leaking Drizzle types
 * into the domain layer.
 */
export interface CreateBasketCalculationRecordInput {
  /** Session identifier for audit-trail grouping. */
  readonly sessionId: string | null;

  /** Destination country (ISO 3166-1 alpha-2). */
  readonly destination: string;

  /** Transport arrangement identifier. */
  readonly transportArrangement: string;

  /** Input basket: JSON array of {productId, quantity}. */
  readonly inputBasket: readonly { productId: number; quantity: number }[];

  /** Per-shipment itemized breakdown — matches BasketShipment[]. */
  readonly shipmentBreakdown: readonly BasketShipment[];

  /** Total estimated landed cost in euro-cents. */
  readonly totalCents: number;

  /** Overall confidence level. */
  readonly confidence: string;

  /** Structural disclaimer text. */
  readonly disclaimer: string;
}

/**
 * Persistence port for basket optimization results.
 *
 * Write-once, read-many.  Enables auditability, correction, and
 * confidence-based ranking per Decision 5.
 *
 * Consumers inject this interface via {@link BASKET_CALCULATION_RECORD_PORT}.
 */
export interface IBasketCalculationRecordPort {
  /**
   * Persist a new basket calculation record.
   *
   * Returns the assigned record ID.  Records are immutable after creation.
   */
  create(
    record: CreateBasketCalculationRecordInput,
  ): Promise<{ id: number }>;
}

/** Injection token for IBasketCalculationRecordPort. */
export const BASKET_CALCULATION_RECORD_PORT = 'BASKET_CALCULATION_RECORD_PORT';

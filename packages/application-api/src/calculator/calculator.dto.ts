/**
 * Calculator DTOs — request/response shapes for the landed-cost calculator API.
 *
 * These are pure interfaces with no NestJS or swagger coupling so they can
 * be shared with API client packages or alternative frontends.
 *
 * @module CalculatorDto
 */

import type {
  CalculatorResult,
  ClassificationResult,
  TransportArrangement,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

/** POST /api/v1/calculator — calculate landed cost for a product. */
export interface CalculateRequest {
  /** Product master ID. */
  readonly productId: number;
  /** Quantity of units (defaults to 1). */
  readonly quantity: number;
  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;
  /** Optional carrier override for transport estimation. */
  readonly transportMethod?: string;
  /**
   * How transport is arranged. Defaults to SELLER_ARRANGED when absent.
   * - `SELLER_ARRANGED`:    Seller arranges and pays for transport.
   * - `INDEPENDENT_CARRIER`: Buyer arranges via third-party carrier.
   * - `PERSONAL`:           Buyer physically carries goods (traveller import).
   */
  readonly transportArrangement?: TransportArrangement;
  /** Optional session identifier for audit-trail grouping. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/**
 * Classification degradation for GET result responses: the transaction
 * classification is not persisted with the calculation record, so the
 * endpoint returns a factual marker instead of deriving a label.  The
 * shared DTO's ClassificationLabel union cannot express absence — this
 * variant can.  Consumers treat it as "unknown for a past result".
 */
export interface UnpersistedClassification {
  readonly classification: 'NotPersisted';
  readonly confidence: 'LOW';
  readonly evidence: [];
  readonly evidenceSummary: string;
}

/**
 * GET /api/v1/calculator/result/:recordId — a previous calculation,
 * reconstructed into the LIVE response shape of POST /api/v1/calculator.
 *
 * Identical to the core-domain CalculatorResult the frontend type mirrors,
 * except `classification`, which may carry the {@link UnpersistedClassification}
 * marker because calculation_records does not persist the classification
 * decision.
 */
export type CalculationResultResponse = Omit<
  CalculatorResult,
  'classification'
> & {
  readonly classification: ClassificationResult | UnpersistedClassification;
};
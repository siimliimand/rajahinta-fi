/**
 * Calculator DTOs — request/response shapes for the landed-cost calculator API.
 *
 * These are pure interfaces with no NestJS or swagger coupling so they can
 * be shared with API client packages or alternative frontends.
 *
 * @module CalculatorDto
 */

import type { TransportArrangement } from '@rajahinta/core-domain';

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

/** GET /api/v1/calculator/result/:recordId — previous calculation record. */
export interface CalculationRecordResponse {
  readonly id: number;
  readonly productMasterId: number;
  readonly totalCents: number;
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: string;
  readonly sessionId: string | null;
  readonly calculatedAt: string;
  readonly productName: string | null;
}
/**
 * Basket DTOs — request/response shapes for the basket optimization API.
 *
 * Pure interfaces with no NestJS or swagger coupling so they can be shared
 * with API client packages or alternative frontends.
 *
 * @module BasketDto
 */

import type { TransportArrangement } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Request DTO
// ---------------------------------------------------------------------------

/** A single product line in the basket optimization request. */
export interface BasketItemInput {
  /** Product master ID (positive integer). */
  readonly productId: number;
  /** Quantity of units (1–99). */
  readonly quantity: number;
}

/**
 * POST /api/v1/basket/optimize — optimize a multi-item basket.
 *
 * Items are validated server-side: 1–10 items, quantity 1–99 per item.
 * Destination is a 2-letter ISO 3166-1 alpha-2 country code.
 */
export interface BasketOptimizeRequest {
  /** Product lines in the basket (1–10 items). */
  readonly items: BasketItemInput[];
  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;
  /**
   * How transport is arranged. Defaults to SELLER_ARRANGED when absent.
   * - `SELLER_ARRANGED`:    Seller arranges and pays for transport.
   * - `INDEPENDENT_CARRIER`: Buyer arranges via third-party carrier.
   * - `PERSONAL`:           Buyer physically carries goods (traveller import).
   */
  readonly transportArrangement?: TransportArrangement;
  /** Optional carrier or transport-method override. */
  readonly transportMethod?: string;
  /** Optional session identifier for audit-trail grouping. */
  readonly sessionId?: string;
}
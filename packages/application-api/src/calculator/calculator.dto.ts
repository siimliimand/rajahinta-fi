/**
 * Calculator DTOs — request/response shapes for the landed-cost calculator API.
 *
 * These are pure interfaces with no NestJS or swagger coupling so they can
 * be shared with API client packages or alternative frontends.
 *
 * @module CalculatorDto
 */

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
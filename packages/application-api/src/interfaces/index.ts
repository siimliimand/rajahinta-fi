/**
 * Pure DTO interfaces for the Application API surface.
 *
 * These interfaces define the request/response shapes that cross
 * the HTTP boundary.  They carry NO NestJS, Swagger, or validation
 * decorators so they can be extracted to a shared API client package
 * or used by alternative frontends without framework coupling.
 *
 * @module ApplicationApiDto
 */

import type {
  ExciseCategory,
  TransactionClass,
  LandedCostResult,
} from '@rajahinta/core-domain';

// --------------------------------------------------------------------------
// Request DTOs
// --------------------------------------------------------------------------

/** POST /api/v1/calculations/excise */
export interface CalculateExciseRequest {
  readonly category: ExciseCategory;
  readonly volumeLitres: number;
  readonly alcoholByVolume: number;
}

/** POST /api/v1/calculations/landed-cost */
export interface CalculateLandedCostRequest {
  readonly retailPriceCents: number;
  readonly transportCostCents: number;
  readonly exciseBase: CalculateExciseRequest | null;
  readonly containerType: string | null;
  readonly containerVolumeLitres: number | null;
  readonly depositSystemVerified: boolean;
  readonly transactionClass: TransactionClass;
}

// --------------------------------------------------------------------------
// Response DTOs
// --------------------------------------------------------------------------

/** GET /api/v1/health */
export interface HealthCheckResponse {
  readonly status: 'ok';
  readonly timestamp: string;
  readonly version: string;
}

/** Standard error body returned by the API. */
export interface ApiErrorResponse {
  readonly statusCode: number;
  readonly message: string;
  readonly error: string;
  readonly timestamp: string;
  readonly path: string;
}

// --------------------------------------------------------------------------
// Use-case orchestrator contract
// --------------------------------------------------------------------------

/**
 * High-level use-case orchestrator for the public API.
 *
 * Wires domain engine, data sources, and audit logging into a single
 * operation.  Concrete implementations are injected by the NestJS host;
 * this interface is the pure contract that alternative hosts can fulfil.
 */
export interface IUseCaseOrchestrator {
  executeCalculation(
    userId: string,
    sessionId: string,
    inputs: CalculateLandedCostRequest,
  ): Promise<LandedCostResult>;
}
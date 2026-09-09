/**
 * DTOs for the legacy calculation endpoints.
 *
 * Shapes mirror the pure interfaces {@link CalculateExciseRequest} and
 * {@link CalculateLandedCostRequest} in `src/interfaces` — the published
 * API contract. Validation is imperative in the controller (the
 * project-wide pattern; no class-validator dependency exists).
 *
 * @module CalculationsDto
 */

// ---------------------------------------------------------------------------
// Excise — POST /api/v1/calculations/excise
// ---------------------------------------------------------------------------

export class CalculateExciseDto {
  /** Excise category (beer, wine, spirits, intermediate, other). */
  category!: 'beer' | 'wine' | 'spirits' | 'intermediate' | 'other';
  /** Volume in litres (must be > 0). */
  volumeLitres!: number;
  /** Alcohol by volume as a decimal fraction (0–1, e.g. 0.047 for 4.7 %). */
  alcoholByVolume!: number;
}

// ---------------------------------------------------------------------------
// Landed cost — POST /api/v1/calculations/landed-cost
// ---------------------------------------------------------------------------

export class CalculateLandedCostDto {
  /** Retail price of the product in euro-cents. */
  retailPriceCents!: number;
  /** Transport cost to Finland in euro-cents. */
  transportCostCents!: number;
  /** Excise inputs — when null, no excise is computed (zero). */
  exciseBase!: CalculateExciseDto | null;
  /** Container/packaging type — when null, no container duty is computed. */
  containerType!: 'glass' | 'plastic' | 'metal' | 'carton' | 'other' | null;
  /** Container volume in litres; required when containerType is present. */
  containerVolumeLitres!: number | null;
  /** Whether the packaging participates in the Finnish deposit-return system. */
  depositSystemVerified!: boolean;
  transactionClass!: 'distance-selling' | 'distance-buying' | 'traveller-import';
  /**
   * Optional import-VAT input (task 4.3, design D6): the seller's ISO
   * 3166-1 alpha-2 country. When present and not 'FI', the response gains
   * an import-VAT term computed on the same versioned base the main
   * calculator uses; when absent or 'FI' (domestic), the term is null and
   * contributes nothing — the pre-change behavior.
   */
  sellerCountry?: string | null;
}

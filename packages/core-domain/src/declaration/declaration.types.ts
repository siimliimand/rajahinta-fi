/**
 * Declaration Assistant types — output summary and data-access contracts for
 * the ExciseDeclarationService.
 *
 * @module DeclarationTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';
import type { ClassificationLabel } from '../classification/classification.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';

// ---------------------------------------------------------------------------
// Read model — what the query port returns from a persisted calculation record
// ---------------------------------------------------------------------------

/**
 * Data returned by the calculation-record query port.
 *
 * Contains every field the declaration service needs to assemble a
 * DeclarationSummary.  Adapters join the calculation record with the product
 * master and transport offer as needed.
 */
export interface CalculationRecordData {
  readonly id: number;
  readonly productName: string;
  readonly productBrand: string | null;
  readonly productCategory: string;
  readonly alcoholByVolume: number;
  readonly volumeLitres: number;
  readonly containerType: string;
  readonly depositSystemStatus: boolean | null;
  readonly quantity: number;
  readonly transportCarrier: string | null;
  readonly transportOrigin: string | null;
  readonly transportDestination: string | null;
  readonly alcoholExciseCents: number;
  readonly containerDutyCents: number;
  readonly totalCents: number;
  readonly confidence: ConfidenceLevel;
  readonly classification: ClassificationLabel;
  readonly disclaimerText: string;
  readonly disclaimerLanguage: 'fi' | 'en';
  readonly disclaimerVersion: string;
  readonly calculationTimestamp: string;
}

// ---------------------------------------------------------------------------
// Port — injected by the data-platform layer
// ---------------------------------------------------------------------------

/**
 * Calculation-record query port.
 *
 * Read-only: declaration assistant never persists anything.  The data-platform
 * layer provides an adapter wired to the calculation_records and product_master
 * tables.
 */
export interface ICalculationRecordQueryPort {
  /**
   * Look up a calculation record by its ID.
   * Returns null when the record does not exist.
   */
  findById(id: number): Promise<CalculationRecordData | null>;
}

/** Injection token for ICalculationRecordQueryPort. */
export const CALCULATION_RECORD_QUERY_PORT = 'CALCULATION_RECORD_QUERY_PORT';

// ---------------------------------------------------------------------------
// Output — DeclarationSummary
// ---------------------------------------------------------------------------

/**
 * Product information section of a declaration summary.
 */
export interface DeclarationProduct {
  readonly name: string;
  readonly brand: string | null;
  readonly category: string;
  readonly abv: number;
  readonly volumeLitres: number;
}

/**
 * Container information section of a declaration summary.
 */
export interface DeclarationContainer {
  readonly type: string;
  readonly volumeLitres: number;
  readonly depositSystemStatus: boolean | null;
}

/**
 * Transport information section of a declaration summary.
 */
export interface DeclarationTransport {
  readonly carrier: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
}

/**
 * Estimated excise section of a declaration summary.
 */
export interface DeclarationEstimatedExcise {
  readonly alcoholExciseCents: number;
  readonly containerDutyCents: number;
  readonly totalCents: number;
  readonly confidence: ConfidenceLevel;
}

/**
 * Advance-notice information for customs declarations.
 *
 * Distance-selling transactions normally do not require advance notice.
 * Traveller imports typically do (4-day deadline).
 */
export interface DeclarationAdvanceNoticeInfo {
  readonly required: boolean;
  readonly deadlineDays?: number;
}

/**
 * Structured declaration summary produced by the ExciseDeclarationService.
 *
 * Packages a completed landed-cost calculation into a declaration-friendly
 * format for Finnish customs / MyTax reference.  Read-only — does NOT
 * submit to any external system.
 */
export interface DeclarationSummary {
  readonly product: DeclarationProduct;
  readonly units: number;
  readonly container: DeclarationContainer;
  readonly transport: DeclarationTransport;
  readonly estimatedExcise: DeclarationEstimatedExcise;
  readonly advanceNoticeInfo: DeclarationAdvanceNoticeInfo;
  readonly myTaxLink: string;
  readonly declarationDate: string;
  readonly disclaimer: Disclaimer;
}

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the requested calculation record cannot be found.
 */
export class CalculationRecordNotFoundError extends Error {
  readonly calculationRecordId: number;

  constructor(calculationRecordId: number) {
    super(`Calculation record ${calculationRecordId} not found`);
    this.name = 'CalculationRecordNotFoundError';
    this.calculationRecordId = calculationRecordId;
  }
}
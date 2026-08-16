/**
 * Calculator types — input/output contracts and port interfaces for the
 * LandedCostCalculatorService orchestrator.
 *
 * @module CalculatorTypes
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';
import type { ConfidenceDetail } from '../reliability/confidence-framework.types';
import type { ClassificationResult } from '../classification/classification.types';

// ---------------------------------------------------------------------------
// Disclaimer — defined locally to avoid circular dependency through barrel
// ---------------------------------------------------------------------------

/**
 * Disclaimer associated with every calculation result.
 */
export interface Disclaimer {
  readonly text: string;
  readonly language: 'fi' | 'en';
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Input to a landed-cost calculation.
 */
export interface CalculatorInput {
  /** Product master ID for the item being calculated. */
  readonly productId: number;

  /** Quantity of units (defaults to 1). */
  readonly quantity: number;

  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;

  /**
   * Optional carrier override for transport estimation.
   * When omitted, the calculator selects the best-matching carrier
   * from the product's retail-offer context.
   */
  readonly transportMethod?: string;

  /** Optional session identifier for grouping calculations in audit trail. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Product and offer data — read models from the product-data port
// ---------------------------------------------------------------------------

/**
 * Product data needed by the calculator, resolved from the product master
 * by the data-access layer.
 */
export interface CalculatorProductData {
  readonly id: number;
  readonly regulatoryClassification: string;
  readonly category: string;
  readonly volumeLitres: number;
  readonly alcoholByVolume: number;
  readonly containerType: string;
  readonly depositSystemStatus: boolean | null;
  /** Weight in kilograms (may be estimated from volume when unknown). */
  readonly weightKg: number;
  readonly normalizedName: string;
}

/**
 * A single retail offer for the product.
 */
export interface CalculatorRetailOfferData {
  readonly id: number;
  readonly priceCents: number;
  readonly merchant: string;
  readonly country: string;
  readonly reliabilityStatus: string;
}

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

/**
 * Machine-readable category for each itemized cost line.
 */
export type CostCategory =
  | 'foreignRetailPrice'
  | 'transportCost'
  | 'alcoholExciseEstimate'
  | 'containerDutyEstimate'
  | 'otherCharges';

/**
 * A single itemized cost line in the calculation result.
 */
export interface ItemizedCost {
  /** Human-readable label (e.g. "Retail price", "Transport", "Excise duty"). */
  readonly label: string;
  /** Machine-readable category identifying the cost component. */
  readonly category: CostCategory;
  /** Amount in euro-cents. */
  readonly cents: number;
  /** Reliability status of this cost component. */
  readonly reliability: ReliabilityStatus;
  /** Optional sub-items for further breakdown. */
  readonly breakdown?: readonly ItemizedCost[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * Full result from the landed-cost calculator.
 */
export interface CalculatorResult {
  /** Itemized list of all cost components. */
  readonly itemizedCosts: readonly ItemizedCost[];

  // ---------------------------------------------------------------------------
  // Convenience breakdown — each component from the itemized list as a flat
  // field for quick access. The authoritative source is `itemizedCosts`.
  // ---------------------------------------------------------------------------

  /** Total price of items from the merchant, in euro-cents. */
  readonly foreignRetailPrice: number;
  /** Shipping/transport cost, in euro-cents. */
  readonly transportCost: number;
  /** Estimated excise duty, in euro-cents. */
  readonly alcoholExciseEstimate: number;
  /** Estimated container duty, in euro-cents. */
  readonly containerDutyEstimate: number;
  /** Any other applicable charges, in euro-cents (zero when none). */
  readonly otherCharges: number;

  /** Sum of all costs in euro-cents at the top level. */
  readonly totalCents: number;
  readonly currency: 'EUR';

  /** Aggregate confidence for the entire result. */
  readonly confidence: ConfidenceLevel;
  /** Per-data-point confidence breakdown with explanations. */
  readonly confidenceBreakdown: readonly ConfidenceDetail[];

  /** The standing legal disclaimer. */
  readonly disclaimer: Disclaimer;

  /** Transaction classification outcome. */
  readonly classification: ClassificationResult;

  /** Calculation metadata. */
  readonly metadata: {
    readonly input: CalculatorInput;
    readonly calculationTimestamp: string; // ISO 8601
    readonly productMasterId: number;
    readonly retailOfferIds: readonly number[];

    // -- Input snapshot --
    /** Quantity used in the calculation. */
    readonly quantity: number;
    /** Destination country used in the calculation. */
    readonly destination: string;
    /** Normalized product name from the product master. */
    readonly productName: string;

    // -- Dataset provenance --
    /** Tax rule versions that were applied (e.g. excise version, container duty version). */
    readonly datasetVersions: readonly string[];
    /** Transport offer ID that was used, or null when unavailable. */
    readonly transportOfferId: number | null;
  };

  /** ID of the persisted calculation record. */
  readonly calculationRecordId: number;
}

// ---------------------------------------------------------------------------
// Persistence input
// ---------------------------------------------------------------------------

/**
 * Data required to persist a calculation record.
 */
export interface CreateCalculationRecordInput {
  readonly productMasterId: number;
  readonly retailOfferIds: readonly number[];
  readonly transportOfferId: number | null;
  readonly exciseRuleVersionId: number | null;
  readonly containerDutyRuleVersionId: number | null;
  readonly totalCents: number;
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: string;
  readonly sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Ports — injected by the composition root (data-platform layer)
// ---------------------------------------------------------------------------

/**
 * Product-data lookup port.
 *
 * The data-platform layer provides an implementation that wires the
 * concrete product and retail-offer repositories.
 */
export interface IProductDataPort {
  /**
   * Look up a product by its master ID.
   * Returns null when the product does not exist.
   */
  findProductById(id: number): Promise<CalculatorProductData | null>;

  /**
   * Return retail offers for the given product.
   */
  findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]>;
}

/**
 * Calculation-record persistence port.
 *
 * Write-once: records are immutable after creation.
 */
export interface ICalculationRecordPort {
  /**
   * Persist a new calculation record.
   * Returns the assigned record ID.
   */
  create(record: CreateCalculationRecordInput): Promise<{ id: number }>;
}

// ---------------------------------------------------------------------------
// Injection tokens — used by the NestJS DI container
// ---------------------------------------------------------------------------

/** Injection token for IProductDataPort. */
export const PRODUCT_DATA_PORT = 'PRODUCT_DATA_PORT';

/** Injection token for ICalculationRecordPort. */
export const CALCULATION_RECORD_PORT = 'CALCULATION_RECORD_PORT';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the classification gate rejects the product.
 */
export class ClassificationGateRejectionError extends Error {
  readonly productId: number;
  readonly reason: string;

  constructor(productId: number, reason: string) {
    super(`Product ${productId} rejected by classification gate: ${reason}`);
    this.name = 'ClassificationGateRejectionError';
    this.productId = productId;
    this.reason = reason;
  }
}

/**
 * Thrown when the product master does not contain the requested product.
 */
export class ProductNotFoundError extends Error {
  readonly productId: number;

  constructor(productId: number) {
    super(`Product ${productId} not found in product master`);
    this.name = 'ProductNotFoundError';
    this.productId = productId;
  }
}

/**
 * Thrown when no retail offers are available for the product.
 */
export class NoRetailOffersError extends Error {
  readonly productId: number;

  constructor(productId: number) {
    super(`No retail offers found for product ${productId}`);
    this.name = 'NoRetailOffersError';
    this.productId = productId;
  }
}
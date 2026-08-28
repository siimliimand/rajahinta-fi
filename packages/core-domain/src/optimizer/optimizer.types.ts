/**
 * Basket optimizer types — input/output contracts for the multi-item
 * landed-cost optimization engine.
 *
 * ## Neutrality
 *
 * This module serves zero billing or promotion-related types or logic.
 * Every cost figure is derived from objective retail prices, published
 * tax rates, and carrier shipping rates — never from commercial signals.
 *
 * ## Design references
 *
 * - Decision 2 (exhaustive search with explicit caps)
 * - Decision 3 (minimum-order threshold as merchant-level sourced data)
 * - Decision 4 (per-shipment consolidated transport)
 * - Spec: explainable result with per-shipment granularity
 *
 * @module OptimizerTypes
 */

import type {
  ItemizedCost,
  TransportArrangement,
  Disclaimer,
} from '../calculator/calculator.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';
import type { ConfidenceDetail } from '../reliability/confidence-framework.types';
import type { ReliabilityStatus } from '../reliability/reliability.types';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Base error for basket optimizer validation failures.
 */
export class BasketValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'BASKET_VALIDATION_ERROR') {
    super(message);
    this.name = 'BasketValidationError';
    this.code = code;
  }
}

/**
 * Thrown when a product in the basket is rejected by the classification gate.
 * Carries the productId so the API layer can map to 422 with context.
 */
export class BasketClassificationGateError extends Error {
  readonly productId: number;

  constructor(productId: number, reason: string) {
    super(`Basket item product ${productId} rejected by classification gate: ${reason}`);
    this.name = 'BasketClassificationGateError';
    this.productId = productId;
  }
}

/**
 * Thrown when the total number of merchant-assignment combinations exceeds
 * {@link MAX_TOTAL_COMBINATIONS}, before any enumeration work begins.
 * Carries the exact counts so the API layer can map to a clean 422 with
 * an explanatory message.
 */
export class BasketCombinationLimitError extends Error {
  readonly totalCombinations: number;
  readonly limit: number;

  constructor(totalCombinations: number, limit: number) {
    super(
      `Basket requires ${totalCombinations} merchant combinations, which exceeds the ` +
        `maximum of ${limit}. Reduce the number of items or the number of merchants per item.`,
    );
    this.name = 'BasketCombinationLimitError';
    this.totalCombinations = totalCombinations;
    this.limit = limit;
  }
}

// ---------------------------------------------------------------------------
// Caps — validated before any computation
// ---------------------------------------------------------------------------

/** Maximum number of distinct items in a basket optimization request. */
export const MAX_BASKET_ITEMS = 10;

/** Maximum candidate merchants per item. */
export const MAX_CANDIDATE_MERCHANTS_PER_ITEM = 8;

/**
 * Maximum total merchant-assignment combinations (Cartesian product of the
 * per-item candidate lists) the optimizer will enumerate.
 *
 * The input caps alone do not bound the search: 10 items at the full
 * 8-merchant cap reach 8^10 ≈ 1.07e9 leaves, far beyond the deployment
 * limits (256m CPU / 512Mi). This bound keeps DFS time sub-second and the
 * in-memory assignment list within the container budget.
 */
export const MAX_TOTAL_COMBINATIONS = 100_000;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** A single product line in the basket input. */
export interface BasketInputItem {
  readonly productId: number;
  readonly quantity: number;
}

/**
 * Input to the basket optimization engine.
 *
 * Contains only objective product, quantity, destination, and transport
 * arrangement data. No commercial or billing signal of any kind.
 */
export interface BasketOptimizationInput {
  /** Product lines in the basket (max {@link MAX_BASKET_ITEMS} items). */
  readonly items: readonly BasketInputItem[];

  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;

  /**
   * How transport is arranged. Defaults to SELLER_ARRANGED when absent.
   * When PERSONAL, only single-store combinations are evaluated (per spec).
   */
  readonly transportArrangement?: TransportArrangement;

  /**
   * Optional carrier or transport-method override.
   * When omitted, the engine resolves the best-matching carrier per shipment.
   */
  readonly transportMethod?: string;

  /** Optional session identifier for audit-trail grouping. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Per-shipment types
// ---------------------------------------------------------------------------

/**
 * Reliability of a consolidated transport estimate.
 *
 * Mirrors the basket-shipping calculator's reliability vocabulary rather
 * than the domain {@link ReliabilityStatus}, which models data-point
 * freshness/verification. A transport estimate may be exact (matching a
 * published bracket), estimated (extrapolated from a neighbouring bracket),
 * or partial (no carrier data available for the route/tier combination).
 */
export type ConsolidatedTransportReliability =
  | 'EXACT'
  | 'ESTIMATED'
  | 'PARTIAL';

/** Consolidated transport estimate for one shipment. */
export interface ConsolidatedTransport {
  /** Total transport cost in euro-cents. */
  readonly totalCents: number;

  /** Weight tier label (e.g. "0–5 kg", "5–10 kg"). */
  readonly weightTier: string;

  /** Package tier identifier (e.g. "parcel", "pallet"). */
  readonly packageTier: string;

  /** Reliability of this transport estimate. */
  readonly reliability: ConsolidatedTransportReliability;
}

/**
 * Minimum-order threshold check for a merchant/shipment.
 *
 * A VERIFIED threshold below the store subtotal makes the combination
 * infeasible (excluded from results). Non-VERIFIED thresholds downgrade
 * confidence but do not exclude the combination.
 */
export interface MinimumOrderThresholdCheck {
  /** Minimum order value in euro-cents, or null when unknown. */
  readonly minimumOrderValueCents: number | null;

  /** Whether the store subtotal meets or exceeds the threshold. */
  readonly meetsThreshold: boolean;

  /**
   * Reliability of the threshold data itself, or null when no threshold
   * record exists for this merchant. When non-null and not VERIFIED, the
   * result confidence is downgraded.
   */
  readonly termsReliability: ReliabilityStatus | null;
}

/**
 * One shipment from a single merchant in the optimized basket.
 *
 * Every cost figure is traceable to its input values, dataset versions,
 * and timestamps at this granularity.
 */
export interface BasketShipment {
  /** Merchant identifier. */
  readonly merchant: string;

  /** Merchant's country (ISO 3166-1 alpha-2). */
  readonly country: string;

  /**
   * Per-item costs for items purchased from this merchant.
   * Each entry reuses {@link ItemizedCost} from the calculator module,
   * guaranteeing component-level consistency with single-item calculator
   * results for identical inputs.
   */
  readonly items: readonly ItemizedCost[];

  /** Consolidated transport estimate for this shipment. */
  readonly consolidatedTransport: ConsolidatedTransport;

  /**
   * Sum of retail prices across all items in this shipment, before
   * taxes, duties, and transport — in euro-cents.
   */
  readonly retailSubtotalCents: number;

  /** Minimum-order threshold feasibility check for this merchant. */
  readonly thresholdCheck: MinimumOrderThresholdCheck;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Metadata for a completed basket optimization. */
export interface BasketOptimizationMetadata {
  /** Echo of the input that produced this result. */
  readonly input: {
    readonly items: readonly BasketInputItem[];
    readonly destination: string;
    readonly transportArrangement?: TransportArrangement;
    readonly transportMethod?: string;
    readonly sessionId?: string;
  };

  /** ISO 8601 timestamp of the calculation. */
  readonly calculationTimestamp: string;

  /** Dataset version identifiers that contributed to this result. */
  readonly datasetVersions: readonly string[];

  /**
   * ID of the persisted basket calculation record, or null when the
   * persistence port is not configured.
   *
   * Used by the correction mechanism to reference a specific result.
   */
  readonly calculationRecordId: number | null;
}

/**
 * An alternative combination in the optimization result.
 *
 * Same shape as {@link BasketOptimizationResult} minus the `alternatives`
 * field (no recursive nesting). The API returns at most 3 alternatives.
 */
export interface BasketOptimizationAlternate {
  readonly shipments: readonly BasketShipment[];
  readonly totalCents: number;
  readonly itemizedTotals: number;
  readonly confidence: ConfidenceLevel;
  readonly confidenceBreakdown: readonly ConfidenceDetail[];
  readonly disclaimer: Disclaimer;
  readonly metadata: BasketOptimizationMetadata;
}

/**
 * Full result from the basket optimization engine.
 *
 * Contains the recommended combination (lowest total), neutral cost-ordered
 * alternatives, per-shipment breakdowns, confidence, and structural disclaimer.
 */
export interface BasketOptimizationResult {
  /** Shipments comprising the recommended combination. */
  readonly shipments: readonly BasketShipment[];

  /** Grand total across all shipments in euro-cents. */
  readonly totalCents: number;

  /** Aggregated total of all itemized cost components (retail + taxes + duties). */
  readonly itemizedTotals: number;

  /** Aggregate confidence for the entire result. */
  readonly confidence: ConfidenceLevel;

  /** Per-data-point confidence breakdown with explanations. */
  readonly confidenceBreakdown: readonly ConfidenceDetail[];

  /** The standing legal disclaimer — structural part of the result. */
  readonly disclaimer: Disclaimer;

  /**
   * Neutral cost-ordered alternatives (at most 3).
   * Each alternative excludes the `alternatives` field to avoid recursion.
   */
  readonly alternatives: readonly BasketOptimizationAlternate[];

  /** Calculation metadata including input echo and dataset provenance. */
  readonly metadata: BasketOptimizationMetadata;
}
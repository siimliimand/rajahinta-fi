/**
 * Basket optimization types — request/response shapes for the multi-item
 * landed-cost optimization API.
 *
 * These mirror the contracts in packages/application-api/src/basket/basket.dto.ts
 * (request) and packages/core-domain/src/optimizer/optimizer.types.ts (response)
 * without importing backend-coupled modules.
 *
 * Per-shipment reliability, per-input confidence breakdowns, alternatives with
 * their own disclaimers, and dataset-version metadata are all surfaced so the UI
 * can render explainable results with minimal client-side transformation.
 *
 * @module BasketTypes
 */

import type {
  ItemizedCost,
  ConfidenceLevel,
  ConfidenceDetail,
  Disclaimer,
} from './types';

// ---------------------------------------------------------------------------
// Request types (POST /api/v1/basket/optimize)
// ---------------------------------------------------------------------------

/**
 * How transport is arranged for a cross-border purchase.
 *
 * - `SELLER_ARRANGED`:     The seller arranges and pays for transport (default).
 * - `INDEPENDENT_CARRIER`: The buyer arranges via a third-party carrier.
 * - `PERSONAL`:            The buyer physically carries goods across the border.
 */
export type TransportArrangement =
  | 'SELLER_ARRANGED'
  | 'INDEPENDENT_CARRIER'
  | 'PERSONAL';

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
  readonly items: readonly BasketItemInput[];
  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;
  /**
   * How transport is arranged. Defaults to SELLER_ARRANGED when absent.
   * When PERSONAL, only single-store combinations are evaluated.
   */
  readonly transportArrangement?: TransportArrangement;
  /** Optional carrier or transport-method override. */
  readonly transportMethod?: string;
  /** Optional session identifier for audit-trail grouping. */
  readonly sessionId?: string;
}

// ---------------------------------------------------------------------------
// Response types — per-shipment
// ---------------------------------------------------------------------------

/**
 * Reliability of a consolidated transport estimate.
 *
 * - `EXACT`:     Matches a published carrier bracket.
 * - `ESTIMATED`: Extrapolated from a neighbouring bracket.
 * - `PARTIAL`:   No carrier data available for the route/tier combination.
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
   * Reliability of the threshold data, or null when no threshold record
   * exists. When non-null and not VERIFIED, result confidence is downgraded.
   */
  readonly termsReliability: string | null;
}

/**
 * One shipment from a single merchant in the optimized basket.
 *
 * Every cost figure is traceable to its input values, dataset versions,
 * and timestamps at this granularity.  The UI renders per-shipment
 * reliability via `consolidatedTransport.reliability` and per-item
 * freshness via each `ItemizedCost.reliability`.
 */
export interface BasketShipment {
  /** Merchant identifier. */
  readonly merchant: string;
  /** Merchant's country (ISO 3166-1 alpha-2). */
  readonly country: string;
  /**
   * Per-item costs for items purchased from this merchant.
   * Each entry carries its own reliability status for freshness display.
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
// Response types — flag-gated packing section (enable_packing_optimizer)
// Mirrors packages/core-domain/src/packing/packing.types.ts without
// importing backend-coupled modules. The section rides on the optimize
// response only when the backend flag is on; off, the key is absent
// entirely and the UI renders no packing panel.
// ---------------------------------------------------------------------------

/** Overall packing suggestion status (mirrors core-domain PackingStatus). */
export type PackingStatus = 'COMPUTED' | 'ESTIMATED';

/** Why a basket line was excluded from the packing suggestion. */
export type PackingExclusionReason =
  | 'MISSING_DIMENSIONS'
  | 'INVALID_DIMENSIONS'
  | 'INVALID_QUANTITY'
  | 'NO_FITTING_BOX';

/** Which mixing-warning threshold fired. */
export type MixingTrigger = 'UNIT_COUNT' | 'COMBINED_WEIGHT';

/** One product grouped inside a packed box. */
export interface PackedBoxItem {
  /** Product master ID. */
  readonly productId: number;
  /** Units of this product packed into the box. */
  readonly units: number;
}

/** One suggested box with its grouped contents. */
export interface PackedBox {
  /** Box catalogue identifier (carrier_box_types.id). */
  readonly boxTypeId: number;
  /** Carrier identifier. */
  readonly carrier: string;
  /** Carrier's published box name. */
  readonly boxName: string;
  /** Products grouped into this box. */
  readonly items: readonly PackedBoxItem[];
  /** Summed packed weight in grams. */
  readonly totalWeightG: number;
  /** Box fill rate 0..1 (unrounded). */
  readonly fillRate: number;
}

/** A basket line that could not be packed. */
export interface ExcludedPackingItem {
  /** Product master ID. */
  readonly productId: number;
  /** Quantity of the excluded basket line. */
  readonly quantity: number;
  /** Why the line was excluded. */
  readonly reason: PackingExclusionReason;
}

/**
 * Glass+metal mixing warning with the triggering figures. Non-null only
 * when at least one threshold fired over the PACKED units.
 */
export interface MixingWarning {
  /** Packed glass units. */
  readonly glassUnits: number;
  /** Packed metal can units. */
  readonly canUnits: number;
  /** Summed packed glass weight in grams. */
  readonly glassWeightG: number;
  /** Summed packed can weight in grams. */
  readonly canWeightG: number;
  /** glassWeightG + canWeightG. */
  readonly combinedWeightG: number;
  /** Every threshold that fired (non-empty when the warning exists). */
  readonly triggeredBy: readonly MixingTrigger[];
}

/** The advisory packing suggestion attached to the optimize response. */
export interface PackingSuggestion {
  /** ESTIMATED the moment any line was excluded (suggestion incomplete). */
  readonly status: PackingStatus;
  /** Suggested boxes in the order the algorithm opened them. */
  readonly boxes: readonly PackedBox[];
  /** Basket lines that could not be packed. */
  readonly excludedItems: readonly ExcludedPackingItem[];
  /** Mixing warning, or null when packed contents stay within thresholds. */
  readonly mixingWarning: MixingWarning | null;
}

// ---------------------------------------------------------------------------
// Response types — result-level
// ---------------------------------------------------------------------------

/** Metadata for a completed basket optimization. */
export interface BasketOptimizationMetadata {
  /** Echo of the input that produced this result. */
  readonly input: {
    readonly items: readonly BasketItemInput[];
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
   * persistence port is not configured.  Used by the correction
   * mechanism to reference a specific result.
   */
  readonly calculationRecordId: number | null;
}

/**
 * An alternative combination in the optimization result.
 *
 * Same shape as BasketOptimizationResult minus the `alternatives` field
 * (no recursive nesting).  The API returns at most 3 alternatives.
 * Each carries its own confidence, confidenceBreakdown, and disclaimer
 * so the UI renders them as independent, cost-ordered options without
 * suggesting promotion of any store (spec: visual neutrality).
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
 * Full result from the basket optimization API.
 *
 * Contains the recommended combination (lowest total), neutral cost-ordered
 * alternatives, per-shipment breakdowns with reliability, aggregate
 * confidence with per-data-point explanations, and the structural disclaimer.
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
  /**
   * Advisory packing suggestion (task 3.3). Present only when the backend
   * `enable_packing_optimizer` flag is on — absent entirely when off, so
   * the UI gates on this key's presence and never on its own flag state.
   */
  readonly packing?: PackingSuggestion;
}
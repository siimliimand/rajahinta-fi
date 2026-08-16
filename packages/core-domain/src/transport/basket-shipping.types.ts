/**
 * Basket shipping types — value objects for basket-level shipping-cost
 * computation.
 *
 * Shipping carriers apply non-linear pricing: a consolidated shipment may
 * qualify for a higher weight tier with a better per-kg rate than the sum
 * of individual-item estimates.  These types model that aggregation.
 *
 * @module BasketShipping
 */

/** An item line in a basket that needs shipping. */
export interface BasketItem {
  readonly weightKg: number;
  readonly packageType: string;
}

/** Per-item cost allocation within a basket estimate. */
export interface BasketItemBreakdown {
  readonly itemIndex: number;
  readonly weightKg: number;
  readonly packageType: string;
  readonly allocatedCents: number;
}

/** Result of a basket-level shipping cost calculation. */
export interface BasketShippingResult {
  readonly totalWeight: number;
  readonly weightTier: string;
  readonly packageTier: string;
  readonly totalCents: number;
  readonly breakdown: readonly BasketItemBreakdown[];
  readonly reliability: 'EXACT' | 'ESTIMATED' | 'PARTIAL';
}

/**
 * Threshold check — answers "does this basket qualify for free shipping?"
 * and if not, how close it is.
 */
export interface BasketShippingThresholdCheck {
  readonly freeShippingThresholdCents: number | null;
  readonly qualifiesForFreeShipping: boolean;
  readonly remainingToFreeCents: number | null;
}
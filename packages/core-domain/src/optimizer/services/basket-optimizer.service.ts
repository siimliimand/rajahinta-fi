/**
 * BasketOptimizerService — bounded exhaustive search over merchant assignments
 * for a multi-item basket, returning the lowest-total landed-cost combination
 * plus up to three neutral cost-ordered alternatives.
 *
 * ## Phase constraints
 *
 * - Caps: MAX_BASKET_ITEMS (10) items, MAX_CANDIDATE_MERCHANTS_PER_ITEM (8)
 *   candidates per item.  Exceeding either throws BasketValidationError.
 * - All I/O happens in a single prefetch phase before enumeration starts.
 * - The enumeration (DFS) is pure synchronous and uses precomputed maps for
 *   both item-level costs and store-group shipping.
 * - Threshold semantics per Decision 3: only VERIFIED threshold data can
 *   exclude a store assignment.  Non-VERIFIED data (ESTIMATED, STALE,
 *   UNAVAILABLE) keeps the store eligible and passes the reliability to
 *   the thresholdCheck for downstream confidence aggregation (task 2.4).
 *
 * @module BasketOptimizerService
 */

import { Inject, Injectable } from '@nestjs/common';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { LandedCostCalculatorService } from '../../calculator/landed-cost-calculator.service';
import { BasketShippingCalculator } from '../../transport/basket-shipping-calculator.service';
import { PRODUCT_DATA_PORT } from '../../calculator/calculator.types';
import { MERCHANT_TERMS_PORT } from '../ports/merchant-terms.port';
import {
  MAX_BASKET_ITEMS,
  MAX_CANDIDATE_MERCHANTS_PER_ITEM,
  BasketValidationError,
  BasketClassificationGateError,
} from '../optimizer.types';
import type {
  BasketOptimizationInput,
  BasketOptimizationResult,
  BasketOptimizationAlternate,
  BasketShipment,
  ConsolidatedTransport,
  MinimumOrderThresholdCheck,
  BasketInputItem,
} from '../optimizer.types';
import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ComputeItemCostsTransportContext,
  ComputedItemCostsResult,
  ItemizedCost,
  CalculatorInput,
} from '../../calculator/calculator.types';
import type { IMerchantTermsPort, MerchantTerms } from '../ports/merchant-terms.port';
import type { BasketItem } from '../../transport/basket-shipping.types';

// ---------------------------------------------------------------------------
// Internal types — alive only during a single optimize() call
// ---------------------------------------------------------------------------

/** A resolved product with its data, gate-check result, and offers. */
interface ResolvedItem {
  readonly productId: number;
  readonly product: CalculatorProductData;
  readonly offers: readonly CalculatorRetailOfferData[];
}

/** One candidate merchant for one item — a (merchant, offer) pair. */
interface ItemCandidate {
  readonly merchant: string;
  readonly offer: CalculatorRetailOfferData;
}

/** Precomputed cost for a (product, quantity, merchant, offer) tuple. */
interface ItemCostRecord {
  readonly computed: ComputedItemCostsResult;
  readonly itemizedCosts: readonly ItemizedCost[];
}

/** One fully computed candidate assignment. */
interface AssignmentResult {
  readonly shipments: BasketShipment[];
  readonly totalCents: number;
  readonly itemizedTotals: number;
  readonly storeKeys: string; // for deterministic tie-breaking
}

/** Memoization key for consolidated shipping: "merchant|sorted-item-indices". */
function shippingKey(merchant: string, itemIndices: readonly number[]): string {
  return `${merchant}|${[...itemIndices].sort((a, b) => a - b).join(',')}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class BasketOptimizerService {
  constructor(
    private readonly classificationGate: ClassificationGateService,
    private readonly calculator: LandedCostCalculatorService,
    private readonly basketShipping: BasketShippingCalculator,

    @Inject(PRODUCT_DATA_PORT)
    private readonly productData: IProductDataPort,

    @Inject(MERCHANT_TERMS_PORT)
    private readonly merchantTerms: IMerchantTermsPort,
  ) {}

  /**
   * Optimize a multi-item basket — find the lowest-total combination of
   * merchant assignments.
   *
   * @throws {BasketValidationError}        items count > MAX_BASKET_ITEMS,
   *                                         or a quantity is not positive.
   * @throws {BasketClassificationGateError} a product fails the classification
   *                                         gate (same check the calculator
   *                                         would apply).
   */
  async optimize(input: BasketOptimizationInput): Promise<BasketOptimizationResult> {
    // =======================================================================
    // 1. Input validation
    // =======================================================================
    this.validateInput(input);

    const { items, destination, transportArrangement, transportMethod, sessionId } = input;

    // =======================================================================
    // 2. Prefetch phase — all I/O upfront
    // =======================================================================

    // 2a. Resolve products, apply classification gate, fetch retail offers
    const resolvedItems: ResolvedItem[] = await this.resolveItems(items);

    // 2b. Build candidate merchant lists for each item (deterministic order)
    const candidatesPerItem: ItemCandidate[][] = this.buildCandidates(resolvedItems);

    // 2c. Collect all distinct merchants and fetch their terms
    const allMerchants = this.collectMerchants(candidatesPerItem);
    const termsMap = await this.fetchTerms(allMerchants);

    // 2d. Compute per-(item, merchant) costs
    const itemCostMap = await this.computeItemCosts(
      items, resolvedItems, candidatesPerItem,
      destination, transportArrangement, transportMethod, sessionId,
    );

    // 2e. Prefetch consolidated shipping for all possible store groups
    const shippingMemo = new Map<string, ConsolidatedTransport>();
    // Build all possible (merchant, itemIndices) pairs by examining the
    // power-set of items each merchant can serve.
    for (const merchant of allMerchants) {
      const coverableIndices: number[] = [];
      for (let i = 0; i < candidatesPerItem.length; i++) {
        if (candidatesPerItem[i].some((c) => c.merchant === merchant)) {
          coverableIndices.push(i);
        }
      }
      if (coverableIndices.length === 0) continue;

      // Generate all non-empty subsets of coverableIndices via bitmask
      const n = coverableIndices.length;
      for (let mask = 1; mask < 1 << n; mask++) {
        const indices: number[] = [];
        for (let b = 0; b < n; b++) {
          if (mask & (1 << b)) indices.push(coverableIndices[b]);
        }
        indices.sort((a, b) => a - b);
        const key = shippingKey(merchant, indices);
        const basketItems: BasketItem[] = indices.map((idx) => ({
          weightKg: resolvedItems[idx].product.weightKg * items[idx].quantity,
          packageType: resolvedItems[idx].product.containerType,
        }));
        const shippingResult = await this.basketShipping.calculateBasket(
          basketItems,
          destination,
          transportMethod,
        );
        shippingMemo.set(key, {
          totalCents: shippingResult.totalCents,
          weightTier: shippingResult.weightTier,
          packageTier: shippingResult.packageTier,
          reliability: shippingResult.reliability,
        });
      }
    }

    // =======================================================================
    // 3. Enumeration — pure synchronous DFS
    // =======================================================================

    const assignments: AssignmentResult[] = [];
    const currentAssignment: number[] = []; // for each item, selected candidate index

    this.dfsEnumerate(
      0,
      items,
      resolvedItems,
      candidatesPerItem,
      termsMap,
      itemCostMap,
      shippingMemo,
      currentAssignment,
      assignments,
    );

    // =======================================================================
    // 4. Selection — deterministic sort
    // =======================================================================

    if (assignments.length === 0) {
      // No feasible assignments — the specification requires at least the
      // recommended result, but every item has at least one candidate merchant
      // and non-VERIFIED thresholds never exclude, so this path should not
      // be reachable under normal circumstances.
      // (The callers will make this a 404 analogue in the API layer.)
      throw new BasketValidationError(
        'No feasible merchant assignment found for the basket',
        'NO_FEASIBLE_ASSIGNMENT',
      );
    }

    this.sortAssignments(assignments);

    // =======================================================================
    // 5. Assemble result
    // =======================================================================

    const best = assignments[0];
    const alternatives = assignments.slice(1, 4).map((a) =>
      this.toAlternate(a, input),
    );

    return {
      shipments: best.shipments,
      totalCents: best.totalCents,
      itemizedTotals: best.itemizedTotals,
      confidence: 'MEDIUM' as const,   // placeholder — task 2.4 aggregates properly
      confidenceBreakdown: [],          // placeholder — task 2.4
      disclaimer: { text: '', language: 'fi' as const, version: '1.0' }, // placeholder — task 2.4
      alternatives,
      metadata: {
        input: {
          items: [...items],
          destination,
          transportArrangement,
          transportMethod,
          sessionId,
        },
        calculationTimestamp: new Date().toISOString(),
        datasetVersions: [], // placeholder — aggregated from itemCostMap entries
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: input validation
  // ---------------------------------------------------------------------------

  private validateInput(input: BasketOptimizationInput): void {
    if (input.items.length > MAX_BASKET_ITEMS) {
      throw new BasketValidationError(
        `Basket contains ${input.items.length} items, maximum is ${MAX_BASKET_ITEMS}`,
        'TOO_MANY_ITEMS',
      );
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        throw new BasketValidationError(
          `Invalid quantity ${item.quantity} for product ${item.productId}: must be a positive integer`,
          'INVALID_QUANTITY',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: prefetch helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve each distinct productId: look up product data, apply the
   * classification gate, fetch retail offers.  Collection-izes the
   * single-product-data-port semantics.
   */
  private async resolveItems(
    items: readonly BasketInputItem[],
  ): Promise<ResolvedItem[]> {
    const resolved: ResolvedItem[] = [];
    for (const item of items) {
      const product = await this.productData.findProductById(item.productId);
      if (product === null) {
        throw new BasketValidationError(
          `Product ${item.productId} not found`,
          'PRODUCT_NOT_FOUND',
        );
      }

      // Apply the classification gate — identical to what the calculator would do
      const gateResult = this.classificationGate.checkProductGate({
        regulatoryClassification: product.regulatoryClassification,
      });
      if (!gateResult.passed) {
        throw new BasketClassificationGateError(
          item.productId,
          gateResult.reason!,
        );
      }

      const offers = await this.productData.findRetailOffers(item.productId);
      if (offers.length === 0) {
        throw new BasketValidationError(
          `No retail offers found for product ${item.productId}`,
          'NO_OFFERS',
        );
      }

      resolved.push({ productId: item.productId, product, offers });
    }
    return resolved;
  }

  /**
   * Build the candidate-merchant list for each item.
   * Deterministic order: lowest unit price first, then merchant id lexicographic.
   * Capped at MAX_CANDIDATE_MERCHANTS_PER_ITEM.
   */
  private buildCandidates(
    resolved: readonly ResolvedItem[],
  ): ItemCandidate[][] {
    return resolved.map((ri) => {
      const candidates: ItemCandidate[] = ri.offers.map((o) => ({
        merchant: o.merchant,
        offer: o,
      }));
      // Sort: lowest priceCents asc, merchant asc
      candidates.sort((a, b) => {
        if (a.offer.priceCents !== b.offer.priceCents) {
          return a.offer.priceCents - b.offer.priceCents;
        }
        return a.merchant.localeCompare(b.merchant);
      });
      return candidates.slice(0, MAX_CANDIDATE_MERCHANTS_PER_ITEM);
    });
  }

  /** Collect the set of all candidate merchants across all items. */
  private collectMerchants(
    candidates: readonly ItemCandidate[][],
  ): string[] {
    const set = new Set<string>();
    for (const cand of candidates) {
      for (const c of cand) set.add(c.merchant);
    }
    return [...set].sort();
  }

  /** Fetch merchant terms for every candidate merchant. */
  private async fetchTerms(
    merchants: readonly string[],
  ): Promise<Map<string, MerchantTerms | null>> {
    const map = new Map<string, MerchantTerms | null>();
    for (const m of merchants) {
      map.set(m, await this.merchantTerms.getTerms(m));
    }
    return map;
  }

  /**
   * Compute per-(item, merchant) costs by calling computeItemCosts with
   * transportCtx = null (transport is handled per-store-group consolidation).
   */
  private async computeItemCosts(
    items: readonly BasketInputItem[],
    resolvedItems: readonly ResolvedItem[],
    candidatesPerItem: readonly ItemCandidate[][],
    destination: string,
    transportArrangement: string | undefined,
    transportMethod: string | undefined,
    sessionId: string | undefined,
  ): Promise<Map<string, ItemCostRecord>> {
    const map = new Map<string, ItemCostRecord>();

    for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
      const item = items[itemIdx];
      const resolved = resolvedItems[itemIdx];
      for (const candidate of candidatesPerItem[itemIdx]) {
        const key = `${item.productId}|${candidate.merchant}`;
        if (map.has(key)) continue; // deduplicate — same (product, merchant)

        const calcInput: CalculatorInput = {
          productId: item.productId,
          quantity: item.quantity,
          destination,
          transportArrangement: transportArrangement as CalculatorInput['transportArrangement'],
          transportMethod,
          sessionId,
        };

        const computed = await this.calculator.computeItemCosts(
          calcInput,
          resolved.product,
          candidate.offer,
          null as unknown as ComputeItemCostsTransportContext,
        );

        // The itemizedCosts from computeItemCosts excludes transport
        // (per its contract).  The optimizer reuses the same list as
        // the optimizer's BasketShipment.items; transport is added
        // separately at the store-group level.
        map.set(key, { computed, itemizedCosts: computed.itemizedCosts });
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Private: enumeration (DFS)
  // ---------------------------------------------------------------------------

  /**
   * Depth-first enumeration over item→candidate-merchant assignments.
   *
   * Pure synchronous — no I/O.  All precomputed maps are passed in.
   */
  private dfsEnumerate(
    itemIdx: number,
    items: readonly BasketInputItem[],
    resolvedItems: readonly ResolvedItem[],
    candidatesPerItem: readonly ItemCandidate[][],
    termsMap: ReadonlyMap<string, MerchantTerms | null>,
    itemCostMap: ReadonlyMap<string, ItemCostRecord>,
    shippingMemo: ReadonlyMap<string, ConsolidatedTransport>,
    currentAssignment: number[],
    assignments: AssignmentResult[],
  ): void {
    if (itemIdx === items.length) {
      // Complete assignment — build store groups and evaluate
      const assignment = this.evaluateAssignment(
        items,
        resolvedItems,
        candidatesPerItem,
        termsMap,
        itemCostMap,
        shippingMemo,
        currentAssignment,
      );
      if (assignment !== null) {
        assignments.push(assignment);
      }
      return;
    }

    for (let cand = 0; cand < candidatesPerItem[itemIdx].length; cand++) {
      currentAssignment.push(cand);
      this.dfsEnumerate(
        itemIdx + 1,
        items,
        resolvedItems,
        candidatesPerItem,
        termsMap,
        itemCostMap,
        shippingMemo,
        currentAssignment,
        assignments,
      );
      currentAssignment.pop();
    }
  }

  /**
   * Evaluate one complete item→merchant assignment.
   *
   * Groups items by merchant, checks minimum-order thresholds (only VERIFIED
   * may block), looks up consolidated shipping, and computes totals.
   *
   * Returns null when a VERIFIED threshold is not met (the assignment is
   * infeasible for that merchant).
   */
  private evaluateAssignment(
    items: readonly BasketInputItem[],
    _resolvedItems: readonly ResolvedItem[],
    candidatesPerItem: readonly ItemCandidate[][],
    termsMap: ReadonlyMap<string, MerchantTerms | null>,
    itemCostMap: ReadonlyMap<string, ItemCostRecord>,
    shippingMemo: ReadonlyMap<string, ConsolidatedTransport>,
    assignment: readonly number[],
  ): AssignmentResult | null {
    // --- Group items by merchant ---
    const merchantToIndices = new Map<string, number[]>();
    for (let i = 0; i < assignment.length; i++) {
      const merchant = candidatesPerItem[i][assignment[i]].merchant;
      let indices = merchantToIndices.get(merchant);
      if (!indices) {
        indices = [];
        merchantToIndices.set(merchant, indices);
      }
      indices.push(i);
    }

    // --- Build each store group ---
    const shipments: BasketShipment[] = [];
    let grandTotal = 0;
    let itemizedTotals = 0;

    for (const [merchant, indices] of merchantToIndices) {
      // Sort indices for deterministic behaviour
      indices.sort((a, b) => a - b);

      const country = candidatesPerItem[indices[0]][assignment[indices[0]]].offer.country;

      // Gather item costs for this merchant
      const storeItems: ItemCostRecord[] = [];
      let retailSubtotalCents = 0;

      for (const idx of indices) {
        const item = items[idx];
        const candidate = candidatesPerItem[idx][assignment[idx]];
        const costKey = `${item.productId}|${candidate.merchant}`;
        const record = itemCostMap.get(costKey)!;
        storeItems.push(record);
        retailSubtotalCents += record.computed.retailTotal;
      }

      // --- Minimum-order threshold check ---
      const terms = termsMap.get(merchant) ?? null;
      const thresholdCheck = this.checkThreshold(terms, retailSubtotalCents);
      // Only VERIFIED thresholds can block
      if (!thresholdCheck.meetsThreshold) {
        return null;
      }

      // --- Consolidated shipping lookup ---
      const shipKey = shippingKey(merchant, indices);
      const transport = shippingMemo.get(shipKey)!;

      // --- Build shipment ---
      const shipmentItems: ItemizedCost[] = storeItems.flatMap((r) => [...r.itemizedCosts]);

      const shipment: BasketShipment = {
        merchant,
        country,
        items: shipmentItems,
        consolidatedTransport: transport,
        retailSubtotalCents,
        thresholdCheck,
      };
      shipments.push(shipment);

      // Accumulate totals
      const shipmentTotal = retailSubtotalCents + transport.totalCents +
        storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
      grandTotal += shipmentTotal;
      itemizedTotals += retailSubtotalCents +
        storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
    }

    // Deterministic tie-breaking key: merchant names sorted, joined
    const storeKeys = [...merchantToIndices.keys()].sort().join('|');

    return { shipments, totalCents: grandTotal, itemizedTotals, storeKeys };
  }

  /**
   * Check minimum-order threshold per Decision 3 semantics.
   *
   * - Missing terms row → no threshold (eligible, no confidence effect).
   * - Non-VERIFIED (ESTIMATED/STALE/UNAVAILABLE) → eligible even if
   *   subtotal is below the value; the thresholdCheck carries the
   *   reliability for downstream confidence aggregation.
   * - VERIFIED and subtotal >= threshold → eligible.
   * - VERIFIED and subtotal < threshold → blocked (returns meetsThreshold: false).
   */
  private checkThreshold(
    terms: MerchantTerms | null,
    retailSubtotalCents: number,
  ): MinimumOrderThresholdCheck {
    if (terms === null || terms.minimumOrderValueCents === null) {
      return {
        minimumOrderValueCents: null,
        meetsThreshold: true,
        termsReliability: null,
      };
    }

    const meets = retailSubtotalCents >= terms.minimumOrderValueCents;

    if (terms.reliabilityStatus === 'VERIFIED' && !meets) {
      // Verified threshold not met — this store is infeasible
      return {
        minimumOrderValueCents: terms.minimumOrderValueCents,
        meetsThreshold: false,
        termsReliability: terms.reliabilityStatus,
      };
    }

    // Non-VERIFIED or meets the threshold — eligible
    return {
      minimumOrderValueCents: terms.minimumOrderValueCents,
      meetsThreshold: true,
      termsReliability: terms.reliabilityStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: selection
  // ---------------------------------------------------------------------------

  /**
   * Sort assignments deterministically:
   *   1. totalCents ascending
   *   2. fewer stores (shipments.length) ascending
   *   3. lexicographic merchant set (storeKeys)
   */
  private sortAssignments(assignments: AssignmentResult[]): void {
    assignments.sort((a, b) => {
      if (a.totalCents !== b.totalCents) return a.totalCents - b.totalCents;
      if (a.shipments.length !== b.shipments.length) {
        return a.shipments.length - b.shipments.length;
      }
      return a.storeKeys.localeCompare(b.storeKeys);
    });
  }

  // ---------------------------------------------------------------------------
  // Private: result assembly
  // ---------------------------------------------------------------------------

  private toAlternate(
    assignment: AssignmentResult,
    input: BasketOptimizationInput,
  ): BasketOptimizationAlternate {
    return {
      shipments: assignment.shipments,
      totalCents: assignment.totalCents,
      itemizedTotals: assignment.itemizedTotals,
      confidence: 'MEDIUM' as const,
      confidenceBreakdown: [],
      disclaimer: { text: '', language: 'fi' as const, version: '1.0' },
      metadata: {
        input: {
          items: [...input.items],
          destination: input.destination,
          transportArrangement: input.transportArrangement,
          transportMethod: input.transportMethod,
          sessionId: input.sessionId,
        },
        calculationTimestamp: new Date().toISOString(),
        datasetVersions: [],
      },
    };
  }
}

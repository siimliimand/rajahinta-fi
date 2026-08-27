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
 * - PERSONAL transport arrangement: only single-store combinations are
 *   evaluated (multi-store splits skipped).
 *
 * @module BasketOptimizerService
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClassificationGateService } from '../../normalization/classification-gate.service';
import { LandedCostCalculatorService } from '../../calculator/landed-cost-calculator.service';
import { BasketShippingCalculator } from '../../transport/basket-shipping-calculator.service';
import { ConfidenceFrameworkService } from '../../reliability/confidence-framework.service';
import { DISCLAIMER_FI } from '../../index';
import { PRODUCT_DATA_PORT } from '../../calculator/calculator.types';
import { MERCHANT_TERMS_PORT } from '../ports/merchant-terms.port';
import { BASKET_CALCULATION_RECORD_PORT } from '../ports/basket-calculation-record.port';
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
import type { IBasketCalculationRecordPort } from '../ports/basket-calculation-record.port';
import type { BasketItem } from '../../transport/basket-shipping.types';
import type { ReliabilityStatus } from '../../reliability/reliability.types';

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

/**
 * Reliability ordering from best to worst.
 * Used by {@link isStricter} to determine the worst status across a set.
 */
const RELIABILITY_ORDER: readonly ReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

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

    @Optional()
    @Inject(BASKET_CALCULATION_RECORD_PORT)
    private readonly calculationRecordPort: IBasketCalculationRecordPort | null,

    private readonly confidenceFramework: ConfidenceFrameworkService,
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
    for (const merchant of allMerchants) {
      const coverableIndices: number[] = [];
      for (let i = 0; i < candidatesPerItem.length; i++) {
        if (candidatesPerItem[i].some((c) => c.merchant === merchant)) {
          coverableIndices.push(i);
        }
      }
      if (coverableIndices.length === 0) continue;

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
    const currentAssignment: number[] = [];

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
      transportArrangement ?? 'SELLER_ARRANGED',
    );

    // =======================================================================
    // 4. Selection — deterministic sort
    // =======================================================================

    if (assignments.length === 0) {
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

    // 5a. Aggregate confidence across ALL inputs across all shipments
    const allConfidenceInputs = this.collectConfidenceInputs(
      best, termsMap, candidatesPerItem, itemCostMap,
    );
    const confidenceReport = this.confidenceFramework.buildReport(allConfidenceInputs);

    // 5b. Collect dataset versions from all item-cost records used
    const allVersions = this.collectDatasetVersions(best, candidatesPerItem, itemCostMap);
    const datasetVersions = [...new Set(allVersions)].sort();

    // 5c. Build alternatives (same disclaimer, per-alternative confidence)
    const alternatives: BasketOptimizationAlternate[] = assignments.slice(1, 4).map((a) => {
      const altInputs = this.collectConfidenceInputs(a, termsMap, candidatesPerItem, itemCostMap);
      const altReport = this.confidenceFramework.buildReport(altInputs);
      return {
        shipments: a.shipments,
        totalCents: a.totalCents,
        itemizedTotals: a.itemizedTotals,
        confidence: altReport.overall,
        confidenceBreakdown: altReport.breakdown,
        disclaimer: DISCLAIMER_FI,
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
          calculationRecordId: null,
        },
      };
    });

    // 5d. Persist the recommended combination
    const confidence = confidenceReport.overall;
    let calculationRecordId: number | null = null;
    if (this.calculationRecordPort) {
      const persisted = await this.calculationRecordPort.create({
        sessionId: sessionId ?? null,
        destination,
        transportArrangement: transportArrangement ?? 'SELLER_ARRANGED',
        inputBasket: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        shipmentBreakdown: best.shipments,
        totalCents: best.totalCents,
        confidence,
        disclaimer: DISCLAIMER_FI.text,
      });
      calculationRecordId = persisted.id;
    }

    return {
      shipments: best.shipments,
      totalCents: best.totalCents,
      itemizedTotals: best.itemizedTotals,
      confidence: confidenceReport.overall,
      confidenceBreakdown: confidenceReport.breakdown,
      disclaimer: DISCLAIMER_FI,
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
        datasetVersions,
        calculationRecordId,
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

  private buildCandidates(
    resolved: readonly ResolvedItem[],
  ): ItemCandidate[][] {
    return resolved.map((ri) => {
      const candidates: ItemCandidate[] = ri.offers.map((o) => ({
        merchant: o.merchant,
        offer: o,
      }));
      candidates.sort((a, b) => {
        if (a.offer.priceCents !== b.offer.priceCents) {
          return a.offer.priceCents - b.offer.priceCents;
        }
        return a.merchant.localeCompare(b.merchant);
      });
      return candidates.slice(0, MAX_CANDIDATE_MERCHANTS_PER_ITEM);
    });
  }

  private collectMerchants(
    candidates: readonly ItemCandidate[][],
  ): string[] {
    const set = new Set<string>();
    for (const cand of candidates) {
      for (const c of cand) set.add(c.merchant);
    }
    return [...set].sort();
  }

  private async fetchTerms(
    merchants: readonly string[],
  ): Promise<Map<string, MerchantTerms | null>> {
    const map = new Map<string, MerchantTerms | null>();
    for (const m of merchants) {
      map.set(m, await this.merchantTerms.getTerms(m));
    }
    return map;
  }

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
        if (map.has(key)) continue;

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

        map.set(key, { computed, itemizedCosts: computed.itemizedCosts });
      }
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Private: enumeration (DFS)
  // ---------------------------------------------------------------------------

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
    transportArrangement: string,
  ): void {
    if (itemIdx === items.length) {
      const assignment = this.evaluateAssignment(
        items,
        resolvedItems,
        candidatesPerItem,
        termsMap,
        itemCostMap,
        shippingMemo,
        currentAssignment,
        transportArrangement,
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
        transportArrangement,
      );
      currentAssignment.pop();
    }
  }

  private evaluateAssignment(
    items: readonly BasketInputItem[],
    _resolvedItems: readonly ResolvedItem[],
    candidatesPerItem: readonly ItemCandidate[][],
    termsMap: ReadonlyMap<string, MerchantTerms | null>,
    itemCostMap: ReadonlyMap<string, ItemCostRecord>,
    shippingMemo: ReadonlyMap<string, ConsolidatedTransport>,
    assignment: readonly number[],
    transportArrangement: string,
  ): AssignmentResult | null {
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

    // PERSONAL: only single-store combinations
    if (transportArrangement === 'PERSONAL' && merchantToIndices.size > 1) {
      return null;
    }

    const shipments: BasketShipment[] = [];
    let grandTotal = 0;
    let itemizedTotals = 0;

    for (const [merchant, indices] of merchantToIndices) {
      indices.sort((a, b) => a - b);

      const country = candidatesPerItem[indices[0]][assignment[indices[0]]].offer.country;

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

      const terms = termsMap.get(merchant) ?? null;
      const thresholdCheck = this.checkThreshold(terms, retailSubtotalCents);
      if (!thresholdCheck.meetsThreshold) {
        return null;
      }

      const shipKey = shippingKey(merchant, indices);
      const transport = shippingMemo.get(shipKey)!;

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

      const shipmentTotal = retailSubtotalCents + transport.totalCents +
        storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
      grandTotal += shipmentTotal;
      itemizedTotals += retailSubtotalCents +
        storeItems.reduce((s, r) => s + r.computed.exciseTotal + r.computed.containerDutyTotal, 0);
    }

    const storeKeys = [...merchantToIndices.keys()].sort().join('|');
    return { shipments, totalCents: grandTotal, itemizedTotals, storeKeys };
  }

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
      return {
        minimumOrderValueCents: terms.minimumOrderValueCents,
        meetsThreshold: false,
        termsReliability: terms.reliabilityStatus,
      };
    }

    return {
      minimumOrderValueCents: terms.minimumOrderValueCents,
      meetsThreshold: true,
      termsReliability: terms.reliabilityStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: selection
  // ---------------------------------------------------------------------------

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
  // Private: confidence aggregation
  // ---------------------------------------------------------------------------

  /**
   * Collect every reliability status from the winning assignment and terms
   * data into an array that ConfidenceFrameworkService.buildReport can consume.
   *
   * Gathers across ALL shipments:
   * - Per-item retail/excise/container-duty/classification statuses
   *   (worst per category across all items)
   * - Per-shipment transport reliability
   * - Per-shipment threshold terms reliability (non-VERIFIED values
   *   included for confidence downgrade)
   */
  private collectConfidenceInputs(
    assignment: AssignmentResult,
    _termsMap: ReadonlyMap<string, MerchantTerms | null>,
    _candidatesPerItem: readonly ItemCandidate[][],
    itemCostMap: ReadonlyMap<string, ItemCostRecord>,
  ): Array<{ status: ReliabilityStatus; label: string }> {
    const inputs: Array<{ status: ReliabilityStatus; label: string }> = [];

    // Collect per-component reliability statuses from the precomputed
    // item-cost records used by this assignment.
    const worstPerCategory = new Map<string, ReliabilityStatus>();

    // Transport reliability per shipment
    for (const shipment of assignment.shipments) {
      const transportRel = this.mapTransportReliability(shipment.consolidatedTransport.reliability);
      const existingTrans = worstPerCategory.get('transport');
      if (!existingTrans || this.isStricter(transportRel, existingTrans)) {
        worstPerCategory.set('transport', transportRel);
      }
    }

    // Per-component statuses from computed records
    for (const [, record] of itemCostMap) {
      const statusPairs: Array<{ cat: string; status: ReliabilityStatus }> = [
        { cat: 'foreignRetailPrice', status: record.computed.retailStatus },
        { cat: 'alcoholExciseEstimate', status: record.computed.exciseStatus },
        { cat: 'containerDutyEstimate', status: record.computed.containerDutyStatus },
      ];
      for (const { cat, status } of statusPairs) {
        const existing = worstPerCategory.get(cat);
        if (!existing || this.isStricter(status, existing)) {
          worstPerCategory.set(cat, status);
        }
      }

      // Classification status
      const existingClass = worstPerCategory.get('classification');
      if (!existingClass || this.isStricter(record.computed.classificationStatus, existingClass)) {
        worstPerCategory.set('classification', record.computed.classificationStatus);
      }
    }

    // Map categories to human-readable labels
    const categoryLabels: Record<string, string> = {
      foreignRetailPrice: 'Price',
      transport: 'Transport',
      alcoholExciseEstimate: 'Excise',
      containerDutyEstimate: 'Container duty',
      classification: 'Classification',
    };

    for (const [cat, status] of worstPerCategory) {
      const label = categoryLabels[cat] ?? cat;
      inputs.push({ status, label });
    }

    // Threshold terms reliability per shipment
    const seenMerchants = new Set<string>();
    for (const shipment of assignment.shipments) {
      const tc = shipment.thresholdCheck;
      if (tc.termsReliability === null) continue;
      if (!seenMerchants.has(shipment.merchant)) {
        seenMerchants.add(shipment.merchant);
        inputs.push({
          status: tc.termsReliability,
          label: `Threshold terms (${shipment.merchant})`,
        });
      }
    }

    return inputs;
  }

  /**
   * Whether `candidate` is stricter (worse) than `current`.
   * Higher index in RELIABILITY_ORDER = stricter = worse.
   */
  private isStricter(candidate: ReliabilityStatus, current: ReliabilityStatus): boolean {
    return RELIABILITY_ORDER.indexOf(candidate) > RELIABILITY_ORDER.indexOf(current);
  }

  /**
   * Map ConsolidatedTransportReliability to the domain ReliabilityStatus.
   */
  private mapTransportReliability(
    rel: 'EXACT' | 'ESTIMATED' | 'PARTIAL',
  ): ReliabilityStatus {
    switch (rel) {
      case 'EXACT': return 'VERIFIED';
      case 'ESTIMATED': return 'ESTIMATED';
      case 'PARTIAL': return 'UNAVAILABLE';
    }
  }

  // ---------------------------------------------------------------------------
  // Private: dataset versions
  // ---------------------------------------------------------------------------

  /**
   * Collect all dataset version strings from the ItemCostRecords referenced
   * by the winning assignment.
   *
   * Collects from the entire itemCostMap (union of all computed results that
   * could be used) — since the map is already deduplicated to one entry per
   * (product, merchant) pair, this covers exactly the set of tax/duty rule
   * versions that were involved.  Duplicates are removed via Set.
   */
  private collectDatasetVersions(
    _assignment: AssignmentResult,
    _candidatesPerItem: readonly ItemCandidate[][],
    itemCostMap: ReadonlyMap<string, ItemCostRecord>,
  ): string[] {
    const versions: string[] = [];
    const seen = new Set<string>();

    for (const [, record] of itemCostMap) {
      for (const v of record.computed.datasetVersions) {
        if (!seen.has(v)) {
          seen.add(v);
          versions.push(v);
        }
      }
    }

    return versions;
  }
}

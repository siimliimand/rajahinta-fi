/**
 * LandedCostCalculatorService — the central orchestrator for cross-border
 * beverage landed-cost calculations.
 *
 * This service coordinates all sub-domains:
 *   1. Classification gate check (product must have regulatory classification)
 *   2. Product master + retail offer lookup
 *   3. Transport cost estimation
 *   4. Excise and container-duty calculation
 *   5. Transaction classification
 *   6. Confidence computation
 *   7. Itemized-result assembly
 *   8. Persistence to calculation records
 *
 * Every number in the result is itemized, sourced, and traced back to its
 * input values — "every number is explainable."
 *
 * @module LandedCostCalculatorService
 */

import { Inject, Injectable } from '@nestjs/common';
import { ClassificationGateService } from '../normalization/classification-gate.service';
import { AlcoholExciseService } from '../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../tax/services/container-duty.service';
import { TransactionClassificationService } from '../classification/transaction-classification.service';
import { ConfidenceFrameworkService } from '../reliability/confidence-framework.service';
import { TransportEstimationService } from '../transport/transport-estimation.service';
import { DISCLAIMER_FI } from '../index';
import type {
  CalculatorInput,
  CalculatorResult,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ItemizedCost,
  IProductDataPort,
  ICalculationRecordPort,
} from './calculator.types';
import {
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
  ClassificationGateRejectionError,
  ProductNotFoundError,
  NoRetailOffersError,
} from './calculator.types';
import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { ClassificationInput } from '../classification/classification.types';

/** Map transport estimation reliability to the canonical ReliabilityStatus. */
function transportReliabilityToStatus(
  r: 'EXACT' | 'ESTIMATED',
): ReliabilityStatus {
  return r === 'EXACT' ? 'VERIFIED' : 'ESTIMATED';
}

@Injectable()
export class LandedCostCalculatorService {
  constructor(
    // --- Gate ---
    private readonly classificationGate: ClassificationGateService,

    // --- Engines ---
    private readonly alcoholExcise: AlcoholExciseService,
    private readonly containerDuty: ContainerDutyService,
    private readonly transactionClassification: TransactionClassificationService,

    // --- Transport ---
    private readonly transportEstimation: TransportEstimationService,

    // --- Confidence ---
    private readonly confidenceFramework: ConfidenceFrameworkService,

    // --- Ports (wired by composition root) ---
    @Inject(PRODUCT_DATA_PORT)
    private readonly productData: IProductDataPort,

    @Inject(CALCULATION_RECORD_PORT)
    private readonly calculationRecords: ICalculationRecordPort,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Calculate the full landed cost for a single product.
   *
   * Steps:
   * 1. Check the classification gate — unclassified products are rejected.
   * 2. Resolve product master data and retail offers.
   * 3. Estimate transport cost.
   * 4. Calculate alcohol excise and container duty.
   * 5. Classify the transaction.
   * 6. Compute overall confidence.
   * 7. Assemble and persist the itemized result.
   */
  async calculate(input: CalculatorInput): Promise<CalculatorResult> {
    // -----------------------------------------------------------------------
    // 1. Classification gate
    // -----------------------------------------------------------------------
    const product = await this.resolveProduct(input);
    const gateResult = this.classificationGate.checkProductGate({
      regulatoryClassification: product.regulatoryClassification,
    });

    if (!gateResult.passed) {
      throw new ClassificationGateRejectionError(
        input.productId,
        gateResult.reason!,
      );
    }

    // -----------------------------------------------------------------------
    // 2. Retail offers — pick the best (lowest price)
    // -----------------------------------------------------------------------
    const offers = await this.productData.findRetailOffers(input.productId);
    if (offers.length === 0) {
      throw new NoRetailOffersError(input.productId);
    }
    const bestOffer = this.selectBestOffer(offers);

    // -----------------------------------------------------------------------
    // 3. Transport estimation
    // -----------------------------------------------------------------------
    const transportResult = await this.estimateTransport(
      input,
      product,
      bestOffer,
    );

    let transportCostCents = 0;
    let transportOfferId: number | null = null;
    let transportStatus: ReliabilityStatus = 'UNAVAILABLE';

    if (transportResult !== null) {
      transportCostCents = transportResult.offer.priceCents;
      transportOfferId = transportResult.offer.id;
      transportStatus = transportReliabilityToStatus(
        transportResult.reliabilityStatus,
      );
    }

    // -----------------------------------------------------------------------
    // 4. Tax engines
    // -----------------------------------------------------------------------

    // Map product category to excise category (lowercase, as the excise engine expects)
    const exciseCategory = product.category.toLowerCase();
    const abvDecimal = product.alcoholByVolume; // already decimal fraction

    const exciseResult = await this.alcoholExcise.calculate(
      exciseCategory,
      abvDecimal,
      product.volumeLitres,
    );

    const containerDutyResult = await this.containerDuty.calculate(
      product.volumeLitres,
      product.containerType,
      product.depositSystemStatus,
    );

    // -----------------------------------------------------------------------
    // 5. Transaction classification
    // -----------------------------------------------------------------------

    // Determine seller-involvement and carrier from transport context
    const sellerInvolvementIndicator =
      transportResult?.offer.sellerInvolvementIndicator ?? false;
    const carrierId = input.transportMethod ?? bestOffer.merchant;
    const sellerCountry = bestOffer.country;

    const classificationInput: ClassificationInput = {
      sellerInvolvementIndicator,
      carrierId,
      sellerCountry,
      buyerCountry: input.destination,
      buyerIsTravelling: false,
      sellerId: bestOffer.merchant,
    };

    const classificationResult =
      await this.transactionClassification.classify(classificationInput);

    // -----------------------------------------------------------------------
    // 6. Confidence computation
    // -----------------------------------------------------------------------

    const productPriceStatus = this.resolveRetailOfferStatus(bestOffer);

    const exciseStatus: ReliabilityStatus = exciseResult.reliability;
    const containerDutyStatus: ReliabilityStatus =
      containerDutyResult.reliability;
    const classificationStatus: ReliabilityStatus =
      classificationResult.confidence === 'HIGH' ? 'VERIFIED' : 'ESTIMATED';

    const confidenceReport = this.confidenceFramework.buildReport([
      { status: productPriceStatus, label: 'productPrice' },
      { status: transportStatus, label: 'transport' },
      { status: exciseStatus, label: 'excise' },
      { status: containerDutyStatus, label: 'containerDuty' },
      { status: classificationStatus, label: 'classification' },
    ]);

    // -----------------------------------------------------------------------
    // 7. Assemble itemized costs
    // -----------------------------------------------------------------------

    const retailCostPerUnit = bestOffer.priceCents;
    const retailTotal = retailCostPerUnit * input.quantity;

    const exciseTotal = exciseResult.taxCents * input.quantity;
    const containerDutyTotal = containerDutyResult.dutyCents * input.quantity;
    const transportTotal = transportCostCents; // transport is per-shipment
    const otherChargesTotal = 0; // no other charges in Phase 1

    const totalCents =
      retailTotal + exciseTotal + containerDutyTotal + transportTotal + otherChargesTotal;

    const itemizedCosts: ItemizedCost[] = [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: retailTotal,
        reliability: productPriceStatus,
        breakdown: [
          {
            label: `Unit price (x${input.quantity})`,
            category: 'foreignRetailPrice' as const,
            cents: retailTotal,
            reliability: productPriceStatus,
          },
        ],
      },
      {
        label: 'Transport',
        category: 'transportCost',
        cents: transportTotal,
        reliability: transportStatus,
      },
      {
        label: 'Alcohol excise',
        category: 'alcoholExciseEstimate',
        cents: exciseTotal,
        reliability: exciseStatus,
      },
      {
        label: 'Container duty',
        category: 'containerDutyEstimate',
        cents: containerDutyTotal,
        reliability: containerDutyStatus,
      },
      {
        label: 'Other charges',
        category: 'otherCharges',
        cents: otherChargesTotal,
        reliability: 'VERIFIED' as const,
      },
    ];

    // Collect dataset versions from tax engines
    const datasetVersions: string[] = [];
    if (exciseResult.taxDatasetVersion) datasetVersions.push(exciseResult.taxDatasetVersion);
    if (containerDutyResult.taxDatasetVersion) datasetVersions.push(containerDutyResult.taxDatasetVersion);

    // -----------------------------------------------------------------------
    // 8. Persist calculation record
    // -----------------------------------------------------------------------

    const persisted = await this.calculationRecords.create({
      productMasterId: product.id,
      retailOfferIds: [bestOffer.id],
      transportOfferId,
      exciseRuleVersionId: null, // exciseResult doesn't carry a numeric version ID
      containerDutyRuleVersionId: null, // same for container duty
      totalCents,
      breakdown: itemizedCosts,
      confidence: confidenceReport.overall,
      quantity: input.quantity,
      destination: input.destination,
      disclaimer: DISCLAIMER_FI.text,
      sessionId: input.sessionId ?? null,
    });

    // -----------------------------------------------------------------------
    // 9. Return result
    // -----------------------------------------------------------------------

    return {
      itemizedCosts,
      foreignRetailPrice: retailTotal,
      transportCost: transportTotal,
      alcoholExciseEstimate: exciseTotal,
      containerDutyEstimate: containerDutyTotal,
      otherCharges: otherChargesTotal,
      totalCents,
      currency: 'EUR',
      confidence: confidenceReport.overall,
      confidenceBreakdown: confidenceReport.breakdown,
      disclaimer: DISCLAIMER_FI,
      classification: classificationResult,
      metadata: {
        input,
        calculationTimestamp: new Date().toISOString(),
        productMasterId: product.id,
        retailOfferIds: [bestOffer.id],
        quantity: input.quantity,
        destination: input.destination,
        productName: product.normalizedName,
        datasetVersions,
        transportOfferId,
      },
      calculationRecordId: persisted.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve product master data. Returns the CalculatorProductData needed
   * by downstream steps.
   */
  private async resolveProduct(
    input: CalculatorInput,
  ): Promise<CalculatorProductData> {
    const product = await this.productData.findProductById(input.productId);
    if (product === null) {
      throw new ProductNotFoundError(input.productId);
    }
    return product;
  }

  /**
   * Select the best retail offer — lowest price wins.
   * This may be enriched with additional scoring in the future.
   */
  private selectBestOffer(
    offers: CalculatorRetailOfferData[],
  ): CalculatorRetailOfferData {
    let best = offers[0];
    for (let i = 1; i < offers.length; i++) {
      if (offers[i].priceCents < best.priceCents) {
        best = offers[i];
      }
    }
    return best;
  }

  /**
   * Estimate transport cost for this product.
   * Returns null when no transport offers are found (graceful degradation).
   */
  private async estimateTransport(
    input: CalculatorInput,
    product: CalculatorProductData,
    offer: CalculatorRetailOfferData,
  ): Promise<{
    offer: { id: number; priceCents: number; sellerInvolvementIndicator: boolean };
    reliabilityStatus: 'EXACT' | 'ESTIMATED';
  } | null> {
    const carrier = input.transportMethod ?? offer.merchant;
    const origin = offer.country;

    try {
      const estimate = await this.transportEstimation.estimate(
        carrier,
        origin,
        input.destination,
        product.weightKg,
        product.containerType,
      );

      return {
        offer: {
          id: estimate.offer.id,
          priceCents: estimate.offer.priceCents,
          sellerInvolvementIndicator: estimate.offer.sellerInvolvementIndicator,
        },
        reliabilityStatus: estimate.reliabilityStatus,
      };
    } catch {
      // No transport offers available — degrade gracefully
      return null;
    }
  }

  /**
   * Map the retail offer's reliability status string to a canonical
   * ReliabilityStatus.
   */
  private resolveRetailOfferStatus(
    offer: CalculatorRetailOfferData,
  ): ReliabilityStatus {
    const raw = offer.reliabilityStatus?.toUpperCase() ?? 'ESTIMATED';
    if (raw === 'EXACT' || raw === 'VERIFIED') return 'VERIFIED';
    if (raw === 'STALE') return 'STALE';
    if (raw === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'ESTIMATED';
  }
}
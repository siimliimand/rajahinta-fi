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
import { DISCLAIMER_FI } from '../disclaimer';
import { computeAlkoBenchmark } from '../benchmark/alko-benchmark';
import type { AlkoReferenceOffer } from '../benchmark/benchmark.types';
import type {
  CalculatorInput,
  CalculatorResult,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ItemizedCost,
  ComputeItemCostsTransportContext,
  ComputedItemCostsResult,
  IProductDataPort,
  ICalculationRecordPort,
  AlkoBenchmarkSnapshot,
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
import { ImportVatService, type ImportVatResult } from '../vat';

/** Merchant id of the domestic reference feed (design D6). */
const ALKO_MERCHANT = 'alko';

@Injectable()
export class LandedCostCalculatorService {
  /**
   * Import-VAT engine (design D5/D6, task 4.3). Pure and dataset-backed —
   * no ports to inject — so it is a field initializer rather than a
   * constructor parameter: every existing construction site (worker
   * routes, test harnesses, spikes) keeps compiling unchanged, and the
   * dataset version travels in the result, not in the wiring.
   */
  private readonly importVat = new ImportVatService();

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
    // 2. Retail offers — every stored offer is EUR (data-quality invariant,
    //    design D3), so the best (lowest-price) offer is always summable.
    // -----------------------------------------------------------------------
    const offers = await this.productData.findRetailOffers(input.productId);
    if (offers.length === 0) {
      throw new NoRetailOffersError(input.productId);
    }
    const bestOffer = this.selectBestOffer(offers);

    // Display-only enrichment, resolved from the same single offers read —
    // the product-data port stays the only lookup machinery. Never enters
    // totals, the itemized breakdown, or any ranking input.
    const alkoBenchmark = this.resolveAlkoBenchmark(offers, bestOffer);

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
      transportStatus = transportResult.reliabilityStatus;
    }

    // -----------------------------------------------------------------------
    // 4–6. Shared item-cost computation (retail, tax, classification, confidence)
    // -----------------------------------------------------------------------
    const transportCtx: ComputeItemCostsTransportContext | null =
      transportResult !== null
        ? {
            transportStatus,
            sellerInvolvementIndicator:
              transportResult.offer.sellerInvolvementIndicator,
            carrierId: input.transportMethod ?? bestOffer.merchant,
            transportCents: transportCostCents,
          }
        : null;

    const computed = await this.computeItemCosts(
      input,
      product,
      bestOffer,
      transportCtx,
    );

    // -----------------------------------------------------------------------
    // 7. Assemble complete itemized costs (inject transport line at position 1)
    // -----------------------------------------------------------------------
    const transportItem: ItemizedCost = {
      label: 'Transport',
      category: 'transportCost',
      cents: transportCostCents,
      reliability: transportStatus,
    };

    const allItemizedCosts: ItemizedCost[] = [
      computed.itemizedCosts[0], // Retail price
      transportItem,
      ...computed.itemizedCosts.slice(1), // Excise, Container duty
    ];

    const totalCents =
      computed.retailTotal +
      transportCostCents +
      computed.exciseTotal +
      computed.containerDutyTotal +
      (computed.importVatTotal ?? 0);

    // -----------------------------------------------------------------------
    // 8. Persist calculation record
    // -----------------------------------------------------------------------

    const persisted = await this.calculationRecords.create({
      productMasterId: product.id,
      retailOfferIds: [bestOffer.id],
      transportOfferId,
      exciseRuleVersionId: computed.exciseRuleVersionId,
      containerDutyRuleVersionId: computed.containerDutyRuleVersionId,
      totalCents,
      breakdown: allItemizedCosts,
      confidence: computed.confidenceOverall,
      quantity: input.quantity,
      destination: input.destination,
      disclaimer: DISCLAIMER_FI,
      sessionId: input.sessionId ?? null,
      ...(alkoBenchmark !== undefined ? { alkoBenchmark } : {}),
    });

    // -----------------------------------------------------------------------
    // 9. Return result
    // -----------------------------------------------------------------------

    return {
      itemizedCosts: allItemizedCosts,
      foreignRetailPrice: computed.retailTotal,
      transportCost: transportCostCents,
      alcoholExciseEstimate: computed.exciseTotal,
      containerDutyEstimate: computed.containerDutyTotal,
      ...(computed.importVatTotal !== undefined
        ? { importVatEstimate: computed.importVatTotal }
        : {}),
      totalCents,
      currency: 'EUR',
      confidence: computed.confidenceOverall,
      confidenceBreakdown: computed.confidenceBreakdown,
      disclaimer: DISCLAIMER_FI,
      classification: computed.classificationResult,
      ...(alkoBenchmark !== undefined ? { alkoBenchmark } : {}),
      metadata: {
        input,
        calculationTimestamp: new Date().toISOString(),
        productMasterId: product.id,
        retailOfferIds: [bestOffer.id],
        quantity: input.quantity,
        destination: input.destination,
        productName: product.normalizedName,
        volumeLitres: product.volumeLitres,
        alcoholByVolume: product.alcoholByVolume,
        category: product.category,
        datasetVersions: computed.datasetVersions,
        transportOfferId,
      },
      calculationRecordId: persisted.id,
    };
  }

  // ---------------------------------------------------------------------------
  // Shared offer-constrained computation
  // ---------------------------------------------------------------------------

  /**
   * Compute item-level costs (retail, excise, container duty, classification,
   * confidence) for a given product + retail-offer pair.
   *
   * WHY transport is a parameter, not computed here:
   *   - The single-item calculator resolves transport via
   *     TransportEstimationService (see #estimateTransport).
   *   - The basket optimizer computes per-store consolidated shipping via
   *     BasketShippingCalculator, which may differ from per-item transport.
   *   - Passing transport context as a parameter lets BOTH paths share every
   *     other engine step (tax, classification, confidence), guaranteeing
   *     T2.8 consistency without constraining transport strategy.
   *
   * @param input       Calculator input (destination, quantity, transport
   *                    arrangement).
   * @param product     Resolved product master data.
   * @param offer       The retail offer to compute costs for.
   * @param transportCtx  Transport context for classification and confidence.
   *                    Pass null when transport is unavailable (confidence
   *                    degrades gracefully).
   */
  async computeItemCosts(
    input: CalculatorInput,
    product: CalculatorProductData,
    offer: CalculatorRetailOfferData,
    transportCtx: ComputeItemCostsTransportContext | null,
  ): Promise<ComputedItemCostsResult> {
    // -----------------------------------------------------------------------
    // Tax engines
    // -----------------------------------------------------------------------

    const exciseCategory = product.category.toLowerCase();
    const exciseResult = await this.alcoholExcise.calculate(
      exciseCategory,
      product.alcoholByVolume,
      product.volumeLitres,
    );

    const containerDutyResult = await this.containerDuty.calculate(
      product.volumeLitres,
      product.containerType,
      product.depositSystemStatus,
    );

    // -----------------------------------------------------------------------
    // Transaction classification
    // -----------------------------------------------------------------------

    const sellerInvolvementIndicator =
      transportCtx?.sellerInvolvementIndicator ?? false;
    const carrierId = transportCtx?.carrierId ?? offer.merchant;
    const transportArrangement =
      input.transportArrangement ?? 'SELLER_ARRANGED';

    const classificationInput: ClassificationInput = {
      sellerInvolvementIndicator,
      carrierId,
      sellerCountry: offer.country,
      buyerCountry: input.destination,
      buyerIsTravelling: transportArrangement === 'PERSONAL',
      sellerId: offer.merchant,
    };

    const classificationResult =
      await this.transactionClassification.classify(classificationInput);

    // -----------------------------------------------------------------------
    // Import VAT — design D6 gate
    // -----------------------------------------------------------------------

    // The SAME seller/buyer country signal transaction classification
    // consumes (classificationInput.sellerCountry/buyerCountry above):
    // the VAT line exists exactly when the seller is established outside
    // the destination. No separate boolean, no classification-label
    // coupling — domestic (alko) offers fail this comparison and skip
    // the line entirely; absence is the zero-contribution state.
    const isImport = offer.country !== input.destination;

    let importVat: ImportVatResult | null = null;
    if (isImport) {
      // The base is the consignment aggregate (price + transport + excise
      // + container duty for the whole line) — the same composition the
      // itemized breakdown below shows. Transport enters once (it is not
      // quantity-scaled); 0 when no transport context exists — the basket
      // path's consolidated shipping resolves after item costs.
      importVat = this.importVat.calculate(
        {
          retailPriceCents: offer.priceCents * input.quantity,
          transportCents: transportCtx?.transportCents ?? 0,
          alcoholExciseCents: exciseResult.taxCents * input.quantity,
          containerDutyCents: containerDutyResult.dutyCents * input.quantity,
        },
        input.transactionDate !== undefined
          ? new Date(input.transactionDate)
          : undefined,
      );
    }

    // -----------------------------------------------------------------------
    // Per-input reliability statuses
    // -----------------------------------------------------------------------

    const retailStatus = this.resolveRetailOfferStatus(offer);
    const exciseStatus: ReliabilityStatus = exciseResult.reliability;
    const containerDutyStatus: ReliabilityStatus =
      containerDutyResult.reliability;
    const classificationStatus: ReliabilityStatus =
      classificationResult.confidence === 'HIGH' ? 'VERIFIED' : 'ESTIMATED';

    const transportStatus: ReliabilityStatus =
      transportCtx?.transportStatus ?? 'UNAVAILABLE';

    // -----------------------------------------------------------------------
    // Confidence computation
    // -----------------------------------------------------------------------

    const confidenceReport = this.confidenceFramework.buildReport([
      { status: retailStatus, label: 'productPrice' },
      { status: transportStatus, label: 'transport' },
      { status: exciseStatus, label: 'excise' },
      { status: containerDutyStatus, label: 'containerDuty' },
      { status: classificationStatus, label: 'classification' },
    ]);

    // -----------------------------------------------------------------------
    // Quantities and derived totals
    // -----------------------------------------------------------------------

    const retailTotal = offer.priceCents * input.quantity;
    const exciseTotal = exciseResult.taxCents * input.quantity;
    const containerDutyTotal = containerDutyResult.dutyCents * input.quantity;

    const datasetVersions: string[] = [];
    if (exciseResult.taxDatasetVersion)
      datasetVersions.push(exciseResult.taxDatasetVersion);
    if (containerDutyResult.taxDatasetVersion)
      datasetVersions.push(containerDutyResult.taxDatasetVersion);
    if (importVat !== null) datasetVersions.push(importVat.rateVersionId);

    // -----------------------------------------------------------------------
    // Itemized costs (transport excluded — caller adds it)
    // -----------------------------------------------------------------------
    const itemizedCosts: ItemizedCost[] = [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: retailTotal,
        reliability: retailStatus,
        breakdown: [
          {
            label: `Unit price (x${input.quantity})`,
            category: 'foreignRetailPrice' as const,
            cents: retailTotal,
            reliability: retailStatus,
          },
        ],
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
    ];

    // The import-VAT line (design D6): amount, rate version, per-component
    // base breakdown, reliability, timestamp. The structural disclaimer
    // already carried by every calculation result covers this line — the
    // figure is an estimate, not the final legal tax liability.
    if (importVat !== null) {
      const baseLines: readonly ItemizedCost[] = [
        {
          label: 'Retail price',
          category: 'foreignRetailPrice',
          cents: retailTotal,
          reliability: importVat.reliability,
        },
        {
          label: 'Transport',
          category: 'transportCost',
          cents: transportCtx?.transportCents ?? 0,
          reliability: importVat.reliability,
        },
        {
          label: 'Alcohol excise',
          category: 'alcoholExciseEstimate',
          cents: exciseTotal,
          reliability: importVat.reliability,
        },
        {
          label: 'Container duty',
          category: 'containerDutyEstimate',
          cents: containerDutyTotal,
          reliability: importVat.reliability,
        },
      ];
      itemizedCosts.push({
        label: 'Import VAT (estimated)',
        category: 'importVatEstimate',
        cents: importVat.vatCents,
        reliability: importVat.reliability,
        rateVersionId: importVat.rateVersionId,
        calculatedAt: importVat.calculatedAt.toISOString(),
        breakdown: baseLines,
      });
    }

    return {
      retailTotal,
      retailStatus,
      exciseTotal,
      exciseStatus,
      exciseRuleVersionId: exciseResult.ruleId,
      containerDutyTotal,
      containerDutyStatus,
      containerDutyRuleVersionId: containerDutyResult.ruleId,
      classificationResult,
      classificationStatus,
      confidenceOverall: confidenceReport.overall,
      confidenceBreakdown: confidenceReport.breakdown,
      datasetVersions,
      ...(importVat !== null
        ? {
            importVatTotal: importVat.vatCents,
            importVatStatus: importVat.reliability,
            importVatRateVersionId: importVat.rateVersionId,
          }
        : {}),
      itemizedCosts,
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
   * Resolve the display-only Alko benchmark from the offers already
   * fetched through the product-data port. Only rows carrying an
   * observation timestamp can serve as references — the deterministic
   * newest-reference selection needs the observation axis — so legacy
   * rows without one are dropped here rather than failing the whole
   * benchmark. An unavailable result degrades to key-absence on the
   * contract: absence is the render-nothing state, never null.
   */
  private resolveAlkoBenchmark(
    offers: CalculatorRetailOfferData[],
    bestOffer: CalculatorRetailOfferData,
  ): AlkoBenchmarkSnapshot | undefined {
    const alkoOffers: AlkoReferenceOffer[] = [];
    for (const offer of offers) {
      if (offer.merchant === ALKO_MERCHANT && offer.observedAt !== undefined) {
        alkoOffers.push({
          id: offer.id,
          priceCents: offer.priceCents,
          reliabilityStatus: offer.reliabilityStatus,
          observedAt: offer.observedAt,
        });
      }
    }

    const benchmark = computeAlkoBenchmark({
      calculatedPriceCents: bestOffer.priceCents,
      alkoOffers,
    });

    return benchmark.status === 'available'
      ? { ...benchmark, observedAt: benchmark.observedAt.toISOString() }
      : undefined;
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
    reliabilityStatus: ReliabilityStatus;
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
    if (raw === 'VERIFIED') return 'VERIFIED';
    if (raw === 'STALE') return 'STALE';
    if (raw === 'UNAVAILABLE') return 'UNAVAILABLE';
    return 'ESTIMATED';
  }
}
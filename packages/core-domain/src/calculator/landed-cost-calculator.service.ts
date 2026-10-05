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

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClassificationGateService } from '../normalization/classification-gate.service';
import { AlcoholExciseService } from '../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../tax/services/container-duty.service';
import { TransactionClassificationService } from '../classification/transaction-classification.service';
import type { EvidenceDetail } from '../classification/classification.types';
import { buildEvidenceSummary } from '../classification/evidence.utils';
import { ConfidenceFrameworkService } from '../reliability/confidence-framework.service';
import type {
  ConfidenceLevel,
  ConfidenceDetail,
} from '../reliability/confidence-framework.types';
import { evaluateLineSanityRail, atMostEstimated } from './sanity-rail';
import { TransportEstimationService } from '../transport/transport-estimation.service';
import { DISCLAIMER_FI } from '../disclaimer';
import { computeAlkoBenchmark } from '../benchmark/alko-benchmark';
import type { AlkoReferenceOffer } from '../benchmark/benchmark.types';
import type {
  CalculatorInput,
  CalculatorResult,
  CalculatorProductData,
  CalculatorRetailOfferData,
  CostLineCode,
  ItemizedCost,
  ComputeItemCostsTransportContext,
  ComputedItemCostsResult,
  IProductDataPort,
  ICalculationRecordPort,
  AlkoBenchmarkSnapshot,
  TravellerAlternativeCallout,
} from './calculator.types';
import {
  isOfferOutOfStock,
  PRODUCT_DATA_PORT,
  CALCULATION_RECORD_PORT,
  ClassificationGateRejectionError,
  NoAllowanceDatasetError,
  ProductNotFoundError,
  NoRetailOffersError,
} from './calculator.types';
import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { ClassificationInput } from '../classification/classification.types';
import { ImportVatService, type ImportVatResult } from '../vat';
import { TRAVELLER_ALLOWANCE_PORT } from '../optimizer/ports/traveller-allowance.port';
import type {
  ITravellerAllowancePort,
  TripResolvedAllowances,
} from '../optimizer/ports/traveller-allowance.port';

/**
 * Fit tolerance for the litres→quantity cap conversion — the same
 * centilitre-granular epsilon the trip-fill engine's maxFitQuantity uses,
 * so the calculator's allowed/surplus split can never disagree with the
 * fill engine on whether a unit fits the cap.
 */
const LITRES_EPSILON = 1e-9;

/**
 * The resolved within/surplus split for one PERSONAL-mode line
 * (task 1.1). `capApplied` is false when the resolved dataset carries no
 * boundable cap for the product's category — the within/over split then
 * does not apply and the full quantity is taxed as before (an absent cap
 * never becomes an invented exemption).
 */
interface TravellerAllowanceSplit {
  /** `versionLabel` of the resolved dataset — provenance. */
  readonly versionLabel: string;
  /** Canonical tax-rule category the cap was looked up with. */
  readonly category: string;
  /** Units covered by the allowance (0 when no cap applies). */
  readonly allowedQuantity: number;
  /** Units above the allowance — the only quantity the engines tax. */
  readonly surplusQuantity: number;
  /** Whether a cap row actually bounded this line. */
  readonly capApplied: boolean;
}

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

    /**
     * Traveller-allowance port (task 1.1). Optional so every existing
     * construction site keeps compiling and behaving unchanged: unwired,
     * PERSONAL requests degrade to the pre-allowance full-taxation math
     * (today's labels-only semantics); wired (calculator route), the
     * branch resolves the published dataset and splits the quantity.
     * `@Optional()` mirrors the optimizer module's null-port default —
     * Nest resolves null when a host module does not bind the token.
     */
    @Optional()
    @Inject(TRAVELLER_ALLOWANCE_PORT)
    private readonly travellerAllowances?: ITravellerAllowancePort | null,
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

    // Benchmark source offers (design D4, change
    // alko-reference-matching-pipeline): the linked reference product's
    // own offers when the request names one — the selection itself stays
    // inside resolveAlkoBenchmark, and the retail best offer above still
    // comes from the calculated product's offers. Only the target
    // product's offer set is mandatory: an override product without
    // offers yields benchmark absence, never an error.
    const benchmarkOffers =
      input.alkoReferenceProductId === undefined
        ? offers
        : await this.productData.findRetailOffers(input.alkoReferenceProductId);

    // Display-only enrichment, resolved from a single offers read per
    // product — the product-data port stays the only lookup machinery.
    // Never enters totals, the itemized breakdown, or any ranking input.
    const alkoBenchmark = this.resolveAlkoBenchmark(
      benchmarkOffers,
      bestOffer,
      input.alkoReferenceProductId,
    );

    // -----------------------------------------------------------------------
    // 3. Transport estimation
    // -----------------------------------------------------------------------
    // D1 (change transport-confidence-unlock): the carrier resolves once —
    // an explicit transportMethod wins, then the merchant registry's
    // carrier assignment, then the merchant name itself as the honest last
    // resort. The estimator normalizes casing (D2); a miss still degrades
    // to the 0 ¢ / UNAVAILABLE path below.
    const resolvedCarrier =
      input.transportMethod ?? bestOffer.carrierId ?? bestOffer.merchant;

    const transportResult = await this.estimateTransport(
      input,
      product,
      bestOffer,
      resolvedCarrier,
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
            carrierId: resolvedCarrier,
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
      code: 'transport',
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
    // 7a. Traveller-alternative callout (task 1.2, delivery mode only)
    // -----------------------------------------------------------------------

    // A PERSONAL result IS the traveller scenario — no callout there (and
    // no second port read; the PERSONAL branch already performed the one
    // allowance read inside computeItemCosts). Delivery arrangements read
    // the port once here; every degrade case yields null and the key is
    // omitted — amounts, statuses, and confidence stay byte-identical
    // (design D4).
    const travellerAlternative =
      (input.transportArrangement ?? 'SELLER_ARRANGED') === 'PERSONAL'
        ? null
        : await this.resolveTravellerAlternativeCallout(
            input,
            product.category.toLowerCase(),
            product.volumeLitres,
            bestOffer.priceCents,
          );

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
      ...(computed.sanityNotes !== undefined
        ? { sanityNotes: computed.sanityNotes }
        : {}),
      disclaimer: DISCLAIMER_FI,
      classification: computed.classificationResult,
      ...(alkoBenchmark !== undefined ? { alkoBenchmark } : {}),
      ...(travellerAlternative !== null ? { travellerAlternative } : {}),
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
        ...(computed.allowanceDatasetVersion !== undefined
          ? { allowanceDatasetVersion: computed.allowanceDatasetVersion }
          : {}),
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
    // Traveller allowance (task 1.1, change finnish-first-client-experience)
    // -----------------------------------------------------------------------

    const transportArrangement =
      input.transportArrangement ?? 'SELLER_ARRANGED';

    // PERSONAL arrangement activates the traveller-import branch: the
    // published allowance dataset effective on the transaction date bounds
    // the quantity, the allowed portion carries retail price only, and the
    // surplus runs the engines below. Delivery arrangements never reach
    // the port — every figure stays identical to the pre-allowance engine
    // (design D4, golden fixtures untouched).
    //
    // An UNWIRED port degrades to the pre-allowance full-taxation math:
    // surfaces that never bind the token (basket composition, cron,
    // golden harnesses) keep today's PERSONAL behavior instead of
    // regressing. A WIRED port that resolves no dataset rejects — caps
    // are never invented (design D3).
    const allowanceSplit =
      transportArrangement === 'PERSONAL'
        ? await this.resolveTravellerAllowanceSplit(
            input,
            exciseCategory,
            product.volumeLitres,
          )
        : null;

    /** The quantity the tax engines apply: the allowance surplus when a
     * cap bounded the line, the full quantity otherwise. Delivery
     * computations always see `input.quantity` here. */
    const taxedQuantity =
      allowanceSplit !== null ? allowanceSplit.surplusQuantity : input.quantity;

    // -----------------------------------------------------------------------
    // Transaction classification
    // -----------------------------------------------------------------------

    const sellerInvolvementIndicator =
      transportCtx?.sellerInvolvementIndicator ?? false;
    const carrierId = transportCtx?.carrierId ?? offer.merchant;

    const classificationInput: ClassificationInput = {
      sellerInvolvementIndicator,
      carrierId,
      sellerCountry: offer.country,
      buyerCountry: input.destination,
      buyerIsTravelling: transportArrangement === 'PERSONAL',
      sellerId: offer.merchant,
    };

    let classificationResult =
      await this.transactionClassification.classify(classificationInput);

    // The allowance application is classification evidence (design D1):
    // the traveller-import label alone says allowances APPLY — the
    // evidence records what was actually applied, to whom (one
    // traveller, design D2), and from which dataset version. Appended
    // after the rule pipeline's own evidence so existing indexes hold.
    if (allowanceSplit !== null) {
      const allowanceEvidence: EvidenceDetail =
        allowanceSplit.capApplied
          ? {
              observation:
                'Traveller allowance applied from the published allowance dataset — the within-allowance quantity carries no excise, container duty, or import VAT; only the surplus is taxed',
              supportingData:
                `allowance dataset: ${allowanceSplit.versionLabel}; ` +
                `category: ${allowanceSplit.category}; travellers: 1; ` +
                `allowance covers ${allowanceSplit.allowedQuantity} of ${input.quantity} units; ` +
                `surplus ${allowanceSplit.surplusQuantity} units taxed`,
              source: 'TravellerAllowance',
            }
          : {
              observation:
                'No traveller-allowance cap covers this product category in the published dataset — no allowance applied and the full quantity is taxed',
              supportingData:
                `allowance dataset: ${allowanceSplit.versionLabel}; ` +
                `category: ${allowanceSplit.category}; travellers: 1`,
              source: 'TravellerAllowance',
            };
      const evidence = [...classificationResult.evidence, allowanceEvidence];
      classificationResult = {
        ...classificationResult,
        evidence,
        evidenceSummary: buildEvidenceSummary(evidence),
      };
    }

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
    if (isImport && taxedQuantity > 0) {
      // The base is the consignment aggregate (price + transport + excise
      // + container duty for the taxed quantity) — the same composition
      // the itemized breakdown below shows. Transport enters once (it is
      // not quantity-scaled); 0 when no transport context exists — the
      // basket path's consolidated shipping resolves after item costs.
      // Under a traveller allowance the base covers the SURPLUS only:
      // same composition, taxed quantity (task 1.1).
      importVat = this.importVat.calculate(
        {
          retailPriceCents: offer.priceCents * taxedQuantity,
          transportCents: transportCtx?.transportCents ?? 0,
          alcoholExciseCents: exciseResult.taxCents * taxedQuantity,
          containerDutyCents: containerDutyResult.dutyCents * taxedQuantity,
        },
        input.transactionDate !== undefined
          ? new Date(input.transactionDate)
          : undefined,
      );
    }

    // -----------------------------------------------------------------------
    // Per-input reliability statuses
    // -----------------------------------------------------------------------

    // Plausibility sanity rail (task 2.1, change
    // unit-integrity-and-result-trust): reads the already-computed line
    // figures and downgrades LABELS only — never an amount. A duty
    // component beyond RETAIL_PLAUSIBILITY_THRESHOLD_MULTIPLE × the
    // line's retail price indicates a unit-conversion or classification
    // regression, so the affected component loses VERIFIED (downgrade
    // only — worse statuses stay) and the overall confidence is forced
    // LOW in the confidence block below.
    const lineRetailPriceCents = offer.priceCents * input.quantity;
    const sanityNotes = evaluateLineSanityRail({
      lineRetailPriceCents,
      lineExciseCents: exciseResult.taxCents * taxedQuantity,
      lineContainerDutyCents:
        containerDutyResult.dutyCents * taxedQuantity,
    });
    const exciseRailTripped = sanityNotes.some(
      (note) => note.component === 'alcoholExciseEstimate',
    );
    const containerDutyRailTripped = sanityNotes.some(
      (note) => note.component === 'containerDutyEstimate',
    );

    const retailStatus = this.resolveRetailOfferStatus(offer);
    const exciseStatus: ReliabilityStatus = exciseRailTripped
      ? atMostEstimated(exciseResult.reliability)
      : exciseResult.reliability;
    const containerDutyStatus: ReliabilityStatus = containerDutyRailTripped
      ? atMostEstimated(containerDutyResult.reliability)
      : containerDutyResult.reliability;
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

    // Rail override (task 2.1): the downgraded ESTIMATED status alone
    // would only yield MEDIUM — a plausibility breach is a suspected
    // data regression, so the result reads LOW regardless of the
    // remaining composition. The breach explanations travel both as
    // machine-readable sanityNotes and as breakdown entries (which the
    // UI already renders) so the downgrade is explainable in place.
    const confidenceOverall: ConfidenceLevel =
      sanityNotes.length > 0 ? 'LOW' : confidenceReport.overall;

    const confidenceBreakdown: readonly ConfidenceDetail[] =
      sanityNotes.length > 0
        ? [
            ...confidenceReport.breakdown,
            ...sanityNotes.map((note) => ({
              status:
                note.component === 'alcoholExciseEstimate'
                  ? exciseStatus
                  : containerDutyStatus,
              detail: note.detail,
              inputName: note.component,
            })),
          ]
        : confidenceReport.breakdown;

    // -----------------------------------------------------------------------
    // Quantities and derived totals
    // -----------------------------------------------------------------------

    const retailTotal = offer.priceCents * input.quantity;
    const exciseTotal = exciseResult.taxCents * taxedQuantity;
    const containerDutyTotal = containerDutyResult.dutyCents * taxedQuantity;

    const datasetVersions: string[] = [];
    if (exciseResult.taxDatasetVersion)
      datasetVersions.push(exciseResult.taxDatasetVersion);
    if (containerDutyResult.taxDatasetVersion)
      datasetVersions.push(containerDutyResult.taxDatasetVersion);
    if (importVat !== null) datasetVersions.push(importVat.rateVersionId);

    // -----------------------------------------------------------------------
    // Itemized costs (transport excluded — caller adds it)
    // -----------------------------------------------------------------------

    // Delivery (and unsplit PERSONAL) keep today's single line per tax
    // component. When a traveller allowance bounded the line, the split
    // is explicit per portion — labeled lines over the SAME canonical
    // categories, no new category space (design D1): the within portion
    // is a dataset-fact zero (VERIFIED — the cap is published data, the
    // application arithmetic), the surplus carries the engine figures.
    const taxLines: ItemizedCost[] =
      allowanceSplit !== null && allowanceSplit.capApplied
        ? [
            ...(allowanceSplit.allowedQuantity > 0
              ? ([
                  {
                    label: 'Alcohol excise (within traveller allowance)',
                    code: 'alcohol_excise_within_allowance',
                    category: 'alcoholExciseEstimate',
                    cents: 0,
                    reliability: 'VERIFIED',
                  },
                  {
                    label: 'Container duty (within traveller allowance)',
                    code: 'container_duty_within_allowance',
                    category: 'containerDutyEstimate',
                    cents: 0,
                    reliability: 'VERIFIED',
                  },
                ] satisfies ItemizedCost[])
            : []),
            ...(taxedQuantity > 0
              ? ([
                  {
                    label: 'Alcohol excise (over-allowance surplus)',
                    code: 'alcohol_excise_over_allowance',
                    category: 'alcoholExciseEstimate',
                    cents: exciseTotal,
                    reliability: exciseStatus,
                  },
                  {
                    label: 'Container duty (over-allowance surplus)',
                    code: 'container_duty_over_allowance',
                    category: 'containerDutyEstimate',
                    cents: containerDutyTotal,
                    reliability: containerDutyStatus,
                  },
                ] satisfies ItemizedCost[])
            : []),
          ]
        : [
            {
              label: 'Alcohol excise',
              code: 'alcohol_excise',
              category: 'alcoholExciseEstimate',
              cents: exciseTotal,
              reliability: exciseStatus,
            },
            {
              label: 'Container duty',
              code: 'container_duty',
              category: 'containerDutyEstimate',
              cents: containerDutyTotal,
              reliability: containerDutyStatus,
            },
          ];

    const itemizedCosts: ItemizedCost[] = [
      {
        label: 'Retail price',
        code: 'foreign_retail_price',
        category: 'foreignRetailPrice',
        cents: retailTotal,
        reliability: retailStatus,
        breakdown: [
          {
            label: `Unit price (x${input.quantity})`,
            code: 'foreign_unit_price',
            category: 'foreignRetailPrice' as const,
            cents: retailTotal,
            reliability: retailStatus,
          },
        ],
      },
      ...taxLines,
    ];

    // The import-VAT line (design D6): amount, rate version, per-component
    // base breakdown, reliability, timestamp. The structural disclaimer
    // already carried by every calculation result covers this line — the
    // figure is an estimate, not the final legal tax liability. Under a
    // traveller allowance the line covers the SURPLUS only, and the
    // within-allowance portion shows as an explicit dataset-fact zero.
    if (isImport && allowanceSplit !== null && allowanceSplit.capApplied && allowanceSplit.allowedQuantity > 0) {
      itemizedCosts.push({
        label: 'Import VAT (within traveller allowance)',
        code: 'import_vat_within_allowance',
        category: 'importVatEstimate',
        cents: 0,
        reliability: 'VERIFIED',
      });
    }
    if (importVat !== null) {
      const baseLines: readonly ItemizedCost[] = [
        {
          label: 'Retail price',
          code: 'foreign_retail_price',
          category: 'foreignRetailPrice',
          cents: offer.priceCents * taxedQuantity,
          reliability: importVat.reliability,
        },
        {
          label: 'Transport',
          code: 'transport',
          category: 'transportCost',
          cents: transportCtx?.transportCents ?? 0,
          reliability: importVat.reliability,
        },
        {
          label: 'Alcohol excise',
          code: 'alcohol_excise',
          category: 'alcoholExciseEstimate',
          cents: exciseTotal,
          reliability: importVat.reliability,
        },
        {
          label: 'Container duty',
          code: 'container_duty',
          category: 'containerDutyEstimate',
          cents: containerDutyTotal,
          reliability: importVat.reliability,
        },
      ];
      // The two label variants are distinct line kinds (design D1): the
      // over-allowance portion carries its own code, not a reworded one.
      const importVatLine: { label: string; code: CostLineCode } =
        allowanceSplit !== null && allowanceSplit.capApplied
          ? {
              label: 'Import VAT (over-allowance surplus, estimated)',
              code: 'import_vat_over_allowance',
            }
          : { label: 'Import VAT (estimated)', code: 'import_vat' };
      itemizedCosts.push({
        ...importVatLine,
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
      confidenceOverall,
      confidenceBreakdown,
      ...(sanityNotes.length > 0 ? { sanityNotes } : {}),
      datasetVersions,
      ...(allowanceSplit !== null
        ? { allowanceDatasetVersion: allowanceSplit.versionLabel }
        : {}),
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
   * The calendar date the allowance lookup uses: the CALENDAR DATE of the
   * transaction (design: today when the request carries no date). The date
   * part of the ISO input is the traveller's own date wording — no
   * timezone re-derivation that could shift the lookup day. Shared by the
   * PERSONAL split and the delivery callout so both resolve the same
   * dataset version within one request.
   */
  private allowanceLookupDate(input: CalculatorInput): string {
    return input.transactionDate !== undefined
      ? input.transactionDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  }

  /**
   * The within-allowance quantity for one line against a RESOLVED dataset —
   * the single implementation of the cap arithmetic, shared by the PERSONAL
   * split and the delivery callout so the two can never disagree on whether
   * a unit fits (task 1.2). Per-dimension bounds; a dimension the cap
   * cannot bound (missing row, non-positive/unbounded unit volume against a
   * litres cap) is skipped rather than guessed. No computable bound at all
   * → null: the cap does not apply.
   *
   * The litres→quantity conversion is the trip-fill engine's
   * floor-plus-{@link LITRES_EPSILON} semantics (same centilitre-granular
   * epsilon as the fill engine's maxFitQuantity).
   */
  private boundQuantityAgainstCaps(
    resolved: TripResolvedAllowances,
    category: string,
    requestedQuantity: number,
    unitVolumeLitres: number,
  ): number | null {
    const capRow =
      resolved.limits.find((limit) => limit.category === category) ?? null;

    let bound = requestedQuantity;
    let boundable = false;
    if (capRow !== null) {
      if (capRow.quantityCap !== null) {
        bound = Math.min(bound, capRow.quantityCap);
        boundable = true;
      }
      if (
        capRow.volumeCapLitres !== null &&
        Number.isFinite(unitVolumeLitres) &&
        unitVolumeLitres > 0
      ) {
        bound = Math.min(
          bound,
          Math.floor(
            (capRow.volumeCapLitres + LITRES_EPSILON) / unitVolumeLitres,
          ),
        );
        boundable = true;
      }
    }

    if (capRow === null || !boundable) return null;
    return Math.max(0, bound);
  }

  /**
   * Resolve the traveller-allowance split for a PERSONAL-mode line
   * (task 1.1): the published dataset effective on the transaction date,
   * the cap row for the product's tax category, and the within/surplus
   * quantity split under the trip-fill engine's cap semantics (same
   * floor-plus-epsilon litres→quantity conversion as the fill engine's
   * maxFitQuantity, so both engines can never disagree on whether a unit
   * fits).
   *
   * - Port unwired → null: the caller's full-quantity path applies
   *   (pre-allowance behavior for surfaces that never bound the token).
   * - Port wired, no PUBLISHED dataset covering the date →
   *   {@link NoAllowanceDatasetError}: a traveller calculation without a
   *   bound is refused, never computed with invented caps (design D3).
   * - Dataset resolved but no (boundable) cap row for the category → a
   *   split with `capApplied: false` and the full quantity as surplus:
   *   the split does not apply, nothing is exempted, the evidence
   *   records why.
   */
  private async resolveTravellerAllowanceSplit(
    input: CalculatorInput,
    category: string,
    unitVolumeLitres: number,
  ): Promise<TravellerAllowanceSplit | null> {
    if (this.travellerAllowances == null) return null;

    const transactionDate = this.allowanceLookupDate(input);

    const resolved = await this.travellerAllowances.resolveForTravelDate(
      transactionDate,
    );
    if (resolved === null) {
      throw new NoAllowanceDatasetError(transactionDate);
    }

    const allowedQuantity = this.boundQuantityAgainstCaps(
      resolved,
      category,
      input.quantity,
      unitVolumeLitres,
    );

    if (allowedQuantity === null) {
      return {
        versionLabel: resolved.dataset.versionLabel,
        category,
        allowedQuantity: 0,
        surplusQuantity: input.quantity,
        capApplied: false,
      };
    }

    return {
      versionLabel: resolved.dataset.versionLabel,
      category,
      allowedQuantity,
      surplusQuantity: input.quantity - allowedQuantity,
      capApplied: true,
    };
  }

  /**
   * Resolve the delivery-mode traveller-alternative callout (task 1.2,
   * change finnish-first-client-experience): what ONE traveller carrying
   * the same quantity would pay within the effective allowance caps —
   * the allowed quantity × the unit shelf price already used for the
   * retail line, via the SAME port resolution and cap arithmetic as the
   * PERSONAL branch ({@link boundQuantityAgainstCaps}), so the callout can
   * never advertise a bound the traveller mode would not apply.
   *
   * Delivery DEGRADES where PERSONAL refuses (design D3/D4): port
   * unwired, no effective dataset, or no boundable cap row for the
   * category all yield null — never an invented cap and never the
   * {@link NoAllowanceDatasetError} rejection (the delivery path stays
   * fully available). Exactly one port read per delivery request; the
   * estimate never alters any delivery figure, status, or confidence.
   */
  private async resolveTravellerAlternativeCallout(
    input: CalculatorInput,
    category: string,
    unitVolumeLitres: number,
    unitShelfPriceCents: number,
  ): Promise<TravellerAlternativeCallout | null> {
    if (this.travellerAllowances == null) return null;

    const resolved = await this.travellerAllowances.resolveForTravelDate(
      this.allowanceLookupDate(input),
    );
    if (resolved === null) return null;

    const allowedQuantity = this.boundQuantityAgainstCaps(
      resolved,
      category,
      input.quantity,
      unitVolumeLitres,
    );
    if (allowedQuantity === null) return null;

    return {
      estimatedTotalCents: allowedQuantity * unitShelfPriceCents,
      withinAllowance: allowedQuantity >= input.quantity,
      allowanceDatasetVersion: resolved.dataset.versionLabel,
      categoryKey: category,
    };
  }

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
   * Select the best retail offer — lowest price wins among offers that are
   * not confirmed out of stock (task 4.1). A persisted `out_of_stock`
   * availability keeps an offer out of default selection, but it stays in
   * the response set for price-history context (proposal decision D6).
   * When EVERY offer is out of stock, selection falls back to the full set
   * — the request still succeeds on the best-known data instead of
   * failing. This may be enriched with additional scoring in the future.
   */
  private selectBestOffer(
    offers: CalculatorRetailOfferData[],
  ): CalculatorRetailOfferData {
    const purchasable = offers.filter((o) => !isOfferOutOfStock(o.availability));
    const pool = purchasable.length > 0 ? purchasable : offers;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
      if (pool[i].priceCents < best.priceCents) {
        best = pool[i];
      }
    }
    return best;
  }

  /**
   * Resolve the display-only Alko benchmark from the given offers already
   * fetched through the product-data port. Only rows carrying an
   * observation timestamp can serve as references — the deterministic
   * newest-reference selection needs the observation axis — so legacy
   * rows without one are dropped here rather than failing the whole
   * benchmark. An unavailable result degrades to key-absence on the
   * contract: absence is the render-nothing state, never null.
   *
   * `referenceProductId` (design D4, change
   * alko-reference-matching-pipeline) records WHICH product the offers
   * came from when the request resolved the benchmark from a linked
   * reference product; it travels on the snapshot so the result and the
   * persisted calculation record keep every figure traceable to its
   * input. Absent → the snapshot is byte-identical to the direct path's.
   */
  private resolveAlkoBenchmark(
    offers: CalculatorRetailOfferData[],
    bestOffer: CalculatorRetailOfferData,
    referenceProductId?: number,
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
      ? {
          ...benchmark,
          observedAt: benchmark.observedAt.toISOString(),
          ...(referenceProductId !== undefined
            ? { referenceProductId }
            : {}),
        }
      : undefined;
  }

  /**
   * Estimate transport cost for this product.
   * Returns null when no transport offers are found (graceful degradation).
   *
   * Weight semantics (change transport-confidence-unlock): the per-unit
   * weight is the stored product weight (grams → kg) when present and
   * positive (design D5); otherwise the volume estimate already carried in
   * `product.weightKg`. D4 multiplies by `input.quantity` — the estimator
   * prices the TOTAL shipment weight against the carrier's brackets.
   * `storedWeightGrams` travels as the estimator's final argument so the
   * weight basis (and the D6 VERIFIED gate) reflects real data only.
   */
  private async estimateTransport(
    input: CalculatorInput,
    product: CalculatorProductData,
    offer: CalculatorRetailOfferData,
    carrier: string,
  ): Promise<{
    offer: { id: number; priceCents: number; sellerInvolvementIndicator: boolean };
    reliabilityStatus: ReliabilityStatus;
  } | null> {
    const origin = offer.country;
    const unitWeightKg =
      product.storedWeightGrams != null && product.storedWeightGrams > 0
        ? product.storedWeightGrams / 1000
        : product.weightKg;
    const shipmentWeightKg = unitWeightKg * input.quantity;

    try {
      const estimate = await this.transportEstimation.estimate(
        carrier,
        origin,
        input.destination,
        shipmentWeightKg,
        product.storedWeightGrams,
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
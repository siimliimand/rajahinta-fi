/**
 * PriceObservationRecorderService — appends one self-contained price
 * observation per changed merchant offer at price-ingestion time.
 *
 * Runs strictly OFF the request path: the price-ingestion background job
 * invokes it; user-facing calculations never append observations.
 *
 * Engine reuse (change 2026-08-26-phase2-historical-price-intelligence,
 * Decision 2): the quantity=1 baseline landed cost is computed through the
 * SAME engine code paths as {@link LandedCostCalculatorService} — the
 * classification gate, product-data port, TransportEstimationService,
 * AlcoholExciseService, ContainerDutyService, and
 * ConfidenceFrameworkService. No calculation logic is duplicated here; the
 * orchestration differs only where an observation is not a user
 * calculation: a SPECIFIC offer is observed (not the best offer), tax
 * rules resolve at `observedAt` (not "now"), nothing is persisted to
 * session-scoped calculation records, and no transaction classification
 * runs (an observation is market data, not a purchase).
 *
 * Tax-rule versions effective at observedAt are resolved through the
 * engines' shared {@link ITaxRuleRepositoryPort} dependency by passing
 * `asOf = observedAt` to every engine call — the snapshotted version is
 * the rule the engine actually applied, never a re-query.
 *
 * @module PriceObservationRecorderService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClassificationGateService } from '../normalization/classification-gate.service';
import { AlcoholExciseService } from '../tax/services/alcohol-excise.service';
import { ContainerDutyService } from '../tax/services/container-duty.service';
import { TransportEstimationService } from '../transport/transport-estimation.service';
import { ConfidenceFrameworkService } from '../reliability/confidence-framework.service';
import type { IProductDataPort } from '../calculator/calculator.types';
import {
  PRODUCT_DATA_PORT,
  ClassificationGateRejectionError,
  ProductNotFoundError,
} from '../calculator/calculator.types';
import type { ReliabilityStatus } from '../reliability/reliability.types';
import type {
  PriceObservation,
  RecordObservationInput,
  RecordedPriceObservation,
  TaxRuleVersionSnapshot,
} from './price-observation.types';
import { PRICE_OBSERVATION_PORT, type IPriceObservationPort } from './price-observation.port';

/**
 * Destination every baseline observation is computed for. The observation
 * log is a Finnish landed-cost series, so the destination is a constant
 * rather than an input — identical to a calculator run with
 * destination "FI".
 */
const OBSERVATION_DESTINATION = 'FI';

/** Baseline quantity of every observation — per-unit series by construction. */
const BASELINE_QUANTITY = 1;

@Injectable()
export class PriceObservationRecorderService {
  private readonly logger = new Logger(PriceObservationRecorderService.name);

  constructor(
    // --- Gate (same check the calculator applies) ---
    private readonly classificationGate: ClassificationGateService,

    // --- Engines (shared with LandedCostCalculatorService) ---
    private readonly alcoholExcise: AlcoholExciseService,
    private readonly containerDuty: ContainerDutyService,
    private readonly transportEstimation: TransportEstimationService,

    // --- Confidence (shared with LandedCostCalculatorService) ---
    private readonly confidenceFramework: ConfidenceFrameworkService,

    // --- Ports (wired by composition root) ---
    @Inject(PRODUCT_DATA_PORT)
    private readonly productData: IProductDataPort,

    @Inject(PRICE_OBSERVATION_PORT)
    private readonly observations: IPriceObservationPort,
  ) {}

  /**
   * Record one observation for a changed merchant offer and append it to
   * the observation log.
   *
   * Mirrors the calculator's steps for identical inputs at quantity=1:
   * gate → product → transport → tax engines (asOf = observedAt) →
   * confidence → cost assembly — then appends instead of persisting a
   * session-scoped calculation record.
   *
   * @throws {ProductNotFoundError}           If the product master lacks the product.
   * @throws {ClassificationGateRejectionError} If the product is unclassified —
   *   an observation must never record a baseline the calculator would refuse.
   */
  async record(input: RecordObservationInput): Promise<RecordedPriceObservation> {
    const { offer, observedAt } = input;

    // -----------------------------------------------------------------------
    // 1. Product resolution + classification gate (calculator parity)
    // -----------------------------------------------------------------------
    const product = await this.productData.findProductById(input.productId);
    if (product === null) {
      throw new ProductNotFoundError(input.productId);
    }

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
    // 2. Transport — select the current offer for the baseline route
    //    (carrier = merchant, origin = offer country, destination = FI)
    // -----------------------------------------------------------------------
    const transport = await this.selectTransportOffer(product, offer);

    // -----------------------------------------------------------------------
    // 3. Tax engines — rules effective at observedAt
    // -----------------------------------------------------------------------
    const exciseResult = await this.alcoholExcise.calculate(
      product.category.toLowerCase(),
      product.alcoholByVolume,
      product.volumeLitres,
      observedAt,
    );

    const containerDutyResult = await this.containerDuty.calculate(
      product.volumeLitres,
      product.containerType,
      product.depositSystemStatus,
      observedAt,
    );

    // -----------------------------------------------------------------------
    // 4. Per-input reliability snapshot
    // -----------------------------------------------------------------------
    const inputReliability = {
      retailPrice: resolveRetailOfferStatus(offer.reliabilityStatus),
      transport: transport.status,
      exciseRule: exciseResult.reliability,
      containerDutyRule: containerDutyResult.reliability,
    };

    // -----------------------------------------------------------------------
    // 5. Confidence — same framework, same labels as the calculator
    // -----------------------------------------------------------------------
    const confidenceReport = this.confidenceFramework.buildReport([
      { status: inputReliability.retailPrice, label: 'productPrice' },
      { status: inputReliability.transport, label: 'transport' },
      { status: inputReliability.exciseRule, label: 'excise' },
      { status: inputReliability.containerDutyRule, label: 'containerDuty' },
    ]);

    // -----------------------------------------------------------------------
    // 6. Quantity=1 baseline landed cost — same composition the calculator
    //    applies at quantity=1 (transport is per-shipment, not per unit)
    // -----------------------------------------------------------------------
    const landedCostCents =
      offer.priceCents * BASELINE_QUANTITY +
      exciseResult.taxCents * BASELINE_QUANTITY +
      containerDutyResult.dutyCents * BASELINE_QUANTITY +
      transport.costCents;

    // -----------------------------------------------------------------------
    // 7. Append the self-contained observation
    // -----------------------------------------------------------------------
    const observation: PriceObservation = {
      productId: product.id,
      merchant: offer.merchant,
      retailOfferId: offer.id,
      observedAt,
      foreignRetailPriceCents: offer.priceCents,
      transportOfferId: transport.offerId,
      transportCostCents: transport.costCents,
      exciseRuleVersion: toRuleVersionSnapshot(
        exciseResult.ruleId,
        exciseResult.taxDatasetVersion,
      ),
      containerDutyRuleVersion: toRuleVersionSnapshot(
        containerDutyResult.ruleId,
        containerDutyResult.taxDatasetVersion,
      ),
      landedCostCents,
      inputReliability,
      confidence: confidenceReport.overall,
    };

    const { id } = await this.observations.append(observation);

    this.logger.log(
      `Recorded observation ${id}: offer ${offer.id} (merchant ` +
        `${offer.merchant}) at ${observedAt.toISOString()}, landed cost ` +
        `${landedCostCents} cents, confidence ${confidenceReport.overall}`,
    );

    return { ...observation, id };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Select the current transport offer for the observation's baseline
   * route. Degrades gracefully exactly like the calculator: when no offer
   * matches, the transport input is UNAVAILABLE at zero cost instead of an
   * error.
   */
  private async selectTransportOffer(
    product: { weightKg: number; containerType: string },
    offer: { merchant: string; country: string },
  ): Promise<{
    offerId: number | null;
    costCents: number;
    status: ReliabilityStatus;
  }> {
    try {
      const estimate = await this.transportEstimation.estimate(
        offer.merchant,
        offer.country,
        OBSERVATION_DESTINATION,
        product.weightKg,
        product.containerType,
      );

      return {
        offerId: estimate.offer.id,
        costCents: estimate.offer.priceCents,
        status: estimate.reliabilityStatus,
      };
    } catch {
      // No transport offers available — degrade gracefully
      return { offerId: null, costCents: 0, status: 'UNAVAILABLE' };
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private mapping helpers
// ---------------------------------------------------------------------------

/**
 * Build the rule-version snapshot from an engine result. `null` when the
 * engine applied no rule row (fallback defaults or exemption) — the
 * reliability snapshot carries the degraded status.
 */
function toRuleVersionSnapshot(
  ruleId: number | null,
  versionLabel: string,
): TaxRuleVersionSnapshot | null {
  return ruleId === null ? null : { ruleId, versionLabel };
}

/**
 * Narrow the retail offer's reliability status to the canonical union.
 *
 * Same defensive mapping as the calculator's offer-status resolution:
 * unknown or legacy values degrade to ESTIMATED — reliability is never
 * overstated.
 */
function resolveRetailOfferStatus(status: ReliabilityStatus): ReliabilityStatus {
  const raw = status?.toUpperCase() ?? 'ESTIMATED';
  if (raw === 'VERIFIED') return 'VERIFIED';
  if (raw === 'STALE') return 'STALE';
  if (raw === 'UNAVAILABLE') return 'UNAVAILABLE';
  return 'ESTIMATED';
}

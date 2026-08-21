/**
 * Transaction Classification Service.
 *
 * This is the platform's most important proprietary logic — it determines
 * the legal framework under which a cross-border beverage purchase falls.
 *
 * The service supports two modes:
 * 1. **Standalone** (default) — uses built-in hardcoded rules reflecting
 *    current Finnish legislation (pre-September 2024).
 * 2. **Engine-backed** — when a {@link ClassificationRuleEngine} is injected,
 *    the service delegates classification to the engine, which loads
 *    versioned rule sets from the repository by effective date.
 *
 * ## Three-way classification
 *
 * - **Distance Selling** — retailer arranges/ships to Finland → seller liable
 * - **Distance Buying** — buyer arranges independent transport → buyer liable
 * - **Traveller Import** — buyer physically transports goods → excluded
 *
 * ## Confidence levels
 *
 * - **HIGH** — all material inputs verified
 * - **MEDIUM** — one or more inputs estimated (e.g., seller identity unknown)
 * - **LOW** — shipping or classification unverifiable
 *
 * @module TransactionClassificationService
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { TransportClassificationService } from '../transport/transport-classification.service';
import {
  ClassificationRuleEngine,
} from './services/classification-rule-engine.service';
import type {
  ClassificationInput,
  ClassificationResult,
  ConfidenceLevel,
  EvidenceDetail,
} from './classification.types';
import { buildEvidenceSummary } from './evidence.utils';

@Injectable()
export class TransactionClassificationService {
  constructor(
    private readonly transportClassification: TransportClassificationService,
    @Optional()
    @Inject(ClassificationRuleEngine)
    private readonly ruleEngine?: ClassificationRuleEngine,
  ) {}

  /**
   * Classify a transaction under Finnish excise law.
   *
   * Delegates to the rule engine when available; otherwise uses built-in
   * hardcoded rules.
   *
   * @param params — All inputs required for classification.
   * @param asOf   — Effective date for rule selection (defaults to now).
   * @returns      A definitive {@link ClassificationResult} with evidence.
   */
  async classify(
    params: ClassificationInput,
    asOf?: Date,
  ): Promise<ClassificationResult> {
    if (this.ruleEngine) {
      const engineResult = await this.ruleEngine.classify(params, asOf);
      return engineResult.result;
    }

    // --- Standalone mode: built-in hardcoded rules ---
    return this.classifyInternal(params);
  }

  /**
   * Synchronous classification using built-in rules only.
   *
   * Useful when the caller cannot await (e.g., in tests or sync contexts).
   * Throws when no rule matches (should never happen with built-in rules).
   */
  classifySync(params: ClassificationInput): ClassificationResult {
    if (this.ruleEngine) {
      const engineResult = this.ruleEngine.classifySync(params);
      return engineResult.result;
    }
    return this.classifyInternal(params);
  }

  /**
   * Internal classification logic — the 4-rule pipeline.
   *
   * Rules evaluated in priority order:
   * 1. Traveller Import — buyerIsTravelling is true
   * 2. Distance Selling — transport is RETAILER_ARRANGED
   * 3. Distance Buying (known carrier) — transport is INDEPENDENT_CARRIER
   * 4. Distance Buying (unknown) — transport is UNKNOWN
   */
  private classifyInternal(params: ClassificationInput): ClassificationResult {
    const transportType = this.transportClassification.classifyTransport(
      params.sellerInvolvementIndicator,
      params.carrierId,
    );

    // --- Rule 1: Traveller Import ---
    if (params.buyerIsTravelling) {
      const evidence: EvidenceDetail[] = [
        {
          observation: 'Buyer indicated they are physically carrying goods across the border',
          supportingData: `destination: ${params.sellerCountry}, buyer country: ${params.buyerCountry}`,
          source: 'buyerIsTravelling',
        },
        {
          observation: 'Personal import allowance applies — excluded from landed-cost calculator',
          supportingData: 'transport arrangement: personal transport',
          source: 'buyerIsTravelling',
        },
      ];
      return {
        classification: 'TravellerImport',
        confidence: 'HIGH',
        evidence,
        evidenceSummary: buildEvidenceSummary(evidence),
      };
    }

    // --- Rule 2: Distance Selling (retailer-arranged transport) ---
    if (transportType === 'RETAILER_ARRANGED') {
      const carrierLabel = params.carrierId && params.carrierId.trim().length > 0
        ? `carrier: ${params.carrierId}`
        : 'carrier information not available';
      const evidence: EvidenceDetail[] = [
        {
          observation: 'Retailer offers direct delivery to buyer\'s country',
          supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}, ${carrierLabel}`,
          source: 'sellerInvolvementIndicator',
        },
      ];
      return {
        classification: 'DistanceSelling',
        confidence: 'HIGH',
        evidence,
        evidenceSummary: buildEvidenceSummary(evidence),
      };
    }

    // --- Rule 3: Distance Buying (independent carrier) ---
    if (transportType === 'INDEPENDENT_CARRIER') {
      // Confidence depends on whether the seller is known
      const confidence: ConfidenceLevel =
        params.sellerId && params.sellerId.trim().length > 0
          ? 'HIGH'
          : 'MEDIUM';

      const evidence: EvidenceDetail[] = [
        {
          observation: 'Buyer arranged transport via independent carrier',
          supportingData: `carrier: ${params.carrierId}`,
          source: 'carrierId',
        },
        {
          observation: 'Seller did not arrange transport',
          supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}`,
          source: 'sellerInvolvementIndicator',
        },
      ];

      if (confidence === 'HIGH') {
        evidence.push({
          observation: 'Seller identity confirmed',
          supportingData: `seller: ${params.sellerId}`,
          source: 'sellerId',
        });
      } else {
        evidence.push({
          observation: 'Seller identity is unverified, reducing confidence',
          supportingData: 'no seller identifier provided',
          source: 'sellerId',
        });
      }

      return {
        classification: 'DistanceBuying',
        confidence,
        evidence,
        evidenceSummary: buildEvidenceSummary(evidence),
      };
    }

    // --- Rule 4: Distance Buying (unknown transport arrangement) ---
    const evidence: EvidenceDetail[] = [
      {
        observation: 'Transport arrangement could not be determined',
        supportingData: `seller country: ${params.sellerCountry}, buyer country: ${params.buyerCountry}, no carrier identified, seller not involved in shipping`,
        source: 'TransportClassification',
      },
    ];
    return {
      classification: 'DistanceBuying',
      confidence: 'LOW',
      evidence,
      evidenceSummary: buildEvidenceSummary(evidence),
    };
  }
}
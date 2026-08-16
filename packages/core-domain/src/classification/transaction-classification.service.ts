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
} from './classification.types';

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
      return {
        classification: 'TravellerImport',
        confidence: 'HIGH',
        evidenceSummary:
          `Buyer from ${params.buyerCountry} indicated they are physically carrying ` +
          `goods across the border from ${params.sellerCountry}. ` +
          'Classified as traveller import per Alcohol Act 1102/2017 chapter 5. ' +
          'This transaction is excluded from landed-cost calculation.',
      };
    }

    // --- Rule 2: Distance Selling (retailer-arranged transport) ---
    if (transportType === 'RETAILER_ARRANGED') {
      return {
        classification: 'DistanceSelling',
        confidence: 'HIGH',
        evidenceSummary:
          `Seller (${params.sellerCountry}) arranged transport to buyer in ` +
          `${params.buyerCountry}. Seller is liable for Finnish excise duties ` +
          'per Alcohol Act 1102/2017 section 43 (distance selling).',
      };
    }

    // --- Rule 3: Distance Buying (independent carrier) ---
    if (transportType === 'INDEPENDENT_CARRIER') {
      // Confidence depends on whether the seller is known
      const confidence: ConfidenceLevel =
        params.sellerId && params.sellerId.trim().length > 0
          ? 'HIGH'
          : 'MEDIUM';

      const summary =
        confidence === 'HIGH'
          ? `Buyer arranged transport via independent carrier (${params.carrierId}) from ` +
            `${params.sellerCountry} to ${params.buyerCountry}. Known seller ` +
            `(${params.sellerId}) confirmed. Buyer is liable for Finnish excise ` +
            'duties upon import (Tax Administration guidance VH/5088/00.01.00/2021).'
          : `Buyer arranged transport via independent carrier (${params.carrierId}) from ` +
            `${params.sellerCountry} to ${params.buyerCountry}. Seller identity is ` +
            'unverified, reducing confidence to MEDIUM. Buyer is liable for Finnish ' +
            'excise duties upon import (Tax Administration guidance VH/5088/00.01.00/2021).';

      return {
        classification: 'DistanceBuying',
        confidence,
        evidenceSummary: summary,
      };
    }

    // --- Rule 4: Distance Buying (unknown transport arrangement) ---
    return {
      classification: 'DistanceBuying',
      confidence: 'LOW',
      evidenceSummary:
        `Transport arrangement from ${params.sellerCountry} to ` +
        `${params.buyerCountry} could not be determined (no carrier identified, ` +
        'seller not involved in shipping). Defaulting to distance buying — ' +
        'buyer should verify their duty liability with Finnish Customs. ' +
        'Reduce uncertainty by providing carrier information.',
    };
  }
}
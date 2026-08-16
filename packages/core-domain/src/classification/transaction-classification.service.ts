/**
 * Transaction Classification Service.
 *
 * This is the platform's most important proprietary logic — it determines
 * the legal framework under which a cross-border beverage purchase falls.
 *
 * The service is designed as an isolated, independently testable module.
 * It depends on {@link TransportClassificationService} purely for transport
 * arrangement classification; all other inputs arrive via
 * {@link ClassificationInput}.
 *
 * ## Rule-based logic (Phase 1)
 *
 * Current rules evaluated in priority order:
 *
 * 1. **Traveller Import** — buyerIsTravelling is true
 * 2. **Distance Selling** — transport is RETAILER_ARRANGED
 * 3. **Distance Buying (known carrier)** — transport is INDEPENDENT_CARRIER
 * 4. **Distance Buying (unknown)** — transport is UNKNOWN
 *
 * Rules will be externalised to a versioned database-backed rule engine in
 * task 6.3.
 *
 * @module TransactionClassificationService
 */
import { Injectable } from '@nestjs/common';
import { TransportClassificationService } from '../transport/transport-classification.service';
import type {
  ClassificationInput,
  ClassificationResult,
} from './classification.types';

@Injectable()
export class TransactionClassificationService {
  constructor(
    private readonly transportClassification: TransportClassificationService,
  ) {}

  /**
   * Classify a transaction under Finnish excise law.
   *
   * @param params - All inputs required for classification.
   * @returns A definitive {@link ClassificationResult} with evidence.
   */
  classify(params: ClassificationInput): ClassificationResult {
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
          'Classified as traveller import per Alcohol Act 1102/2017 chapter 5.',
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
      return {
        classification: 'DistanceBuying',
        confidence: 'HIGH',
        evidenceSummary:
          `Buyer arranged transport via independent carrier (${params.carrierId}) from ` +
          `${params.sellerCountry} to ${params.buyerCountry}. Buyer is liable for ` +
          'Finnish excise duties upon import (Tax Administration guidance ' +
          'VH/5088/00.01.00/2021).',
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
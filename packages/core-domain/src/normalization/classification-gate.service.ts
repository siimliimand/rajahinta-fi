/**
 * ClassificationGateService — ensures a product carries a regulatory
 * classification before it enters the landed-cost pipeline.
 *
 * Every canonical product must carry a `regulatoryClassification` that is
 * a member of the known classification vocabulary
 * ({@link KNOWN_REGULATORY_CLASSIFICATIONS}) before it can appear in a
 * landed-cost calculation. Non-emptiness alone does not pass: the
 * placeholder 'unknown' that feed adapters historically stamped, and any
 * other non-member value, is rejected. Unclassified products are
 * excluded — never shown with a guessed classification.
 *
 * The gate is a pure check: it does not assign classifications, nor does
 * it know how classifications are determined. That is the responsibility
 * of the RegulatoryClassificationService (task 7.x) and the product
 * master's classification assignment logic.
 *
 * @module ClassificationGateService
 */

import { Injectable } from '@nestjs/common';
import {
  KNOWN_REGULATORY_CLASSIFICATIONS,
  REGULATORY_CLASSIFICATION_PLACEHOLDER,
} from './normalization.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result of checking a product against the classification gate.
 */
export interface GateResult {
  /** True when the product passes the gate and may enter landed-cost calculation. */
  readonly passed: boolean;
  /** Human-readable explanation when `passed` is false. */
  readonly reason?: string;
}

/**
 * Shape of the product data the gate inspects.
 *
 * This is intentionally a minimal subset — the gate only checks the
 * `regulatoryClassification` field. Accepting a larger object would
 * couple the gate to the full ProductMaster shape unnecessarily.
 */
export interface GateProduct {
  /** The product's regulatory classification (e.g. ExciseCategory). */
  readonly regulatoryClassification: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ClassificationGateService {
  /**
   * Check whether a product passes the classification gate.
   *
   * A product passes iff its `regulatoryClassification` is a non-empty,
   * case-insensitive member of the known classification vocabulary.
   * The placeholder value 'unknown' and every other non-member are
   * rejected with a distinct reason.
   *
   * This is a pure synchronous function — no I/O, no side effects.
   */
  checkProductGate(product: GateProduct): GateResult {
    if (
      product.regulatoryClassification === null ||
      product.regulatoryClassification === undefined
    ) {
      return {
        passed: false,
        reason: 'Product lacks regulatory classification',
      };
    }

    const trimmed = product.regulatoryClassification.trim();
    if (trimmed === '') {
      return {
        passed: false,
        reason: 'Product lacks regulatory classification',
      };
    }

    const normalized = trimmed.toLowerCase();
    if (normalized === REGULATORY_CLASSIFICATION_PLACEHOLDER) {
      return {
        passed: false,
        reason: 'regulatoryClassification "unknown" is a placeholder, not a classification',
      };
    }

    if (!KNOWN_REGULATORY_CLASSIFICATIONS.has(normalized)) {
      return {
        passed: false,
        reason: `regulatoryClassification "${trimmed}" is not a member of the known classification enum`,
      };
    }

    return { passed: true };
  }
}